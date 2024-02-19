// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interfaces/IIAgentVault.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./Minting.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";


library CollateralReservations {
    using SafePct for *;
    using SafeCast for uint256;
    using AgentCollateral for Collateral.CombinedData;
    using Agent for Agent.State;

    function reserveCollateral(
        address _minter,
        address _agentVault,
        uint64 _lots,
        uint64 _maxMintingFeeBIPS,
        address payable _executor
    )
        internal
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireWhitelistedAgentVaultOwner(agent);
        Collateral.CombinedData memory collateralData = AgentCollateral.combinedData(agent);
        AssetManagerState.State storage state = AssetManagerState.get();
        require(state.pausedAt == 0, "minting paused");
        require(agent.availableAgentsPos != 0, "agent not in mint queue");
        require(_lots > 0, "cannot mint 0 lots");
        require(agent.status == Agent.Status.NORMAL, "rc: invalid agent status");
        require(collateralData.freeCollateralLots(agent) >= _lots, "not enough free collateral");
        require(_maxMintingFeeBIPS >= agent.feeBIPS, "agent's fee too high");
        uint64 valueAMG = _lots * state.settings.lotSizeAMG;
        uint256 underlyingValueUBA = Conversion.convertAmgToUBA(valueAMG);
        uint256 underlyingFeeUBA = underlyingValueUBA.mulBips(agent.feeBIPS);
        _reserveCollateral(agent, valueAMG, underlyingFeeUBA);
        // poolCollateral is WNat, so we can use its price
        uint256 reservationFee = _reservationFee(collateralData.poolCollateral.amgToTokenWeiPrice, valueAMG);
        require(msg.value >= reservationFee, "inappropriate fee amount");
        (uint64 lastUnderlyingBlock, uint64 lastUnderlyingTimestamp) = _lastPaymentBlock();
        state.newCrtId += PaymentReference.randomizedIdSkip();
        uint64 crtId = state.newCrtId;   // pre-increment - id can never be 0
        // create in-memory cr and then put it to storage to not go out-of-stack
        CollateralReservation.Data memory cr;
        cr.valueAMG = valueAMG;
        cr.underlyingFeeUBA = underlyingFeeUBA.toUint128();
        cr.reservationFeeNatWei = reservationFee.toUint128();
        cr.agentVault = _agentVault;
        cr.minter = _minter;
        cr.firstUnderlyingBlock = state.currentUnderlyingBlock;
        cr.lastUnderlyingBlock = lastUnderlyingBlock;
        cr.lastUnderlyingTimestamp = lastUnderlyingTimestamp;
        cr.executor = _executor;
        cr.executorFeeNatGWei = ((msg.value - reservationFee) / Conversion.GWEI).toUint64();
        state.crts[crtId] = cr;
        // emit event
        _emitCollateralReservationEvent(agent, cr, crtId);
    }

    function mintingPaymentDefault(
        ReferencedPaymentNonexistence.Proof calldata _nonPayment,
        uint64 _crtId
    )
        internal
    {
        CollateralReservation.Data storage crt = getCollateralReservation(_crtId);
        Agent.State storage agent = Agent.get(crt.agentVault);
        Agents.requireAgentVaultOwner(agent);
        // check requirements
        TransactionAttestation.verifyReferencedPaymentNonexistence(_nonPayment);
        uint256 underlyingValueUBA = Conversion.convertAmgToUBA(crt.valueAMG);
        require(_nonPayment.data.requestBody.standardPaymentReference == PaymentReference.minting(_crtId) &&
            _nonPayment.data.requestBody.destinationAddressHash == agent.underlyingAddressHash &&
            _nonPayment.data.requestBody.amount == underlyingValueUBA + crt.underlyingFeeUBA,
            "minting non-payment mismatch");
        require(_nonPayment.data.responseBody.firstOverflowBlockNumber > crt.lastUnderlyingBlock &&
            _nonPayment.data.responseBody.firstOverflowBlockTimestamp > crt.lastUnderlyingTimestamp,
            "minting default too early");
        require(_nonPayment.data.requestBody.minimalBlockNumber <= crt.firstUnderlyingBlock,
            "minting non-payment proof window too short");
        // send event
        uint256 reservedValueUBA = underlyingValueUBA + Minting.calculatePoolFee(agent, crt.underlyingFeeUBA);
        emit AMEvents.MintingPaymentDefault(crt.agentVault, crt.minter, _crtId, reservedValueUBA);
        // share collateral reservation fee between the agent's vault and pool
        uint256 totalFee = crt.reservationFeeNatWei + crt.executorFeeNatGWei * Conversion.GWEI;
        uint256 poolFeeShare = totalFee.mulBips(agent.poolFeeShareBIPS);
        agent.collateralPool.depositNat{value: poolFeeShare}();
        IIAgentVault(crt.agentVault).depositNat{value: totalFee - poolFeeShare}(Globals.getWNat());
        // release agent's reserved collateral
        releaseCollateralReservation(crt, _crtId);  // crt can't be used after this
    }

    function unstickMinting(
        ConfirmedBlockHeightExists.Proof calldata _proof,
        uint64 _crtId
    )
        internal
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        CollateralReservation.Data storage crt = getCollateralReservation(_crtId);
        Agent.State storage agent = Agent.get(crt.agentVault);
        Agents.requireAgentVaultOwner(agent);
        // verify proof
        TransactionAttestation.verifyConfirmedBlockHeightExists(_proof);
        // enough time must pass so that proofs are no longer available
        require(_proof.data.responseBody.lowestQueryWindowBlockNumber > crt.lastUnderlyingBlock
            && _proof.data.responseBody.lowestQueryWindowBlockTimestamp > crt.lastUnderlyingTimestamp
            && _proof.data.responseBody.lowestQueryWindowBlockTimestamp + settings.attestationWindowSeconds <=
                _proof.data.responseBody.blockTimestamp,
            "cannot unstick minting yet");
        // burn collateral reservation fee (guarded against reentrancy in AssetManager.unstickMinting)
        Agents.burnDirectNAT(crt.reservationFeeNatWei);
        // burn reserved collateral at market price
        uint256 amgToTokenWeiPrice = Conversion.currentAmgPriceInTokenWei(agent.vaultCollateralIndex);
        uint256 reservedCollateral = Conversion.convertAmgToTokenWei(crt.valueAMG, amgToTokenWeiPrice);
        Agents.burnVaultCollateral(agent, reservedCollateral);
        // send event
        uint256 reservedValueUBA = Conversion.convertAmgToUBA(crt.valueAMG) +
            Minting.calculatePoolFee(agent, crt.underlyingFeeUBA);
        emit AMEvents.CollateralReservationDeleted(crt.agentVault, crt.minter, _crtId, reservedValueUBA);
        // release agent's reserved collateral
        releaseCollateralReservation(crt, _crtId);  // crt can't be used after this
    }

    function calculateReservationFee(
        uint64 _lots
    )
        internal view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 amgToTokenWeiPrice = Conversion.currentAmgPriceInTokenWei(state.poolCollateralIndex);
        return _reservationFee(amgToTokenWeiPrice, _lots * state.settings.lotSizeAMG);
    }

    function releaseCollateralReservation(
        CollateralReservation.Data storage crt,
        uint64 _crtId
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(crt.agentVault);
        uint64 reservationAMG = _reservationAMG(agent, crt.valueAMG, crt.underlyingFeeUBA);
        agent.reservedAMG = SafeMath64.sub64(agent.reservedAMG, reservationAMG, "invalid reservation");
        state.totalReservedCollateralAMG -= reservationAMG;
        delete state.crts[_crtId];
    }

    function getCollateralReservation(
        uint64 _crtId
    )
        internal view
        returns (CollateralReservation.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(_crtId > 0 && state.crts[_crtId].valueAMG != 0, "invalid crt id");
        return state.crts[_crtId];
    }

    function _reserveCollateral(
        Agent.State storage _agent,
        uint64 _valueAMG,
        uint256 _underlyingFeeUBA
    )
        private
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint64 reservationAMG = _reservationAMG(_agent, _valueAMG, _underlyingFeeUBA);
        Minting.checkMintingCap(reservationAMG);
        _agent.reservedAMG += reservationAMG;
        state.totalReservedCollateralAMG += reservationAMG;
    }

    function _emitCollateralReservationEvent(
        Agent.State storage _agent,
        CollateralReservation.Data memory _cr,
        uint64 _crtId
    )
        private
    {
        emit AMEvents.CollateralReserved(
            _agent.vaultAddress(),
            _cr.minter,
            _crtId,
            Conversion.convertAmgToUBA(_cr.valueAMG),
            _cr.underlyingFeeUBA,
            _cr.firstUnderlyingBlock,
            _cr.lastUnderlyingBlock,
            _cr.lastUnderlyingTimestamp,
            _agent.underlyingAddressString,
            PaymentReference.minting(_crtId),
            _cr.executor,
            _cr.executorFeeNatGWei * Conversion.GWEI);
    }

    function _reservationAMG(
        Agent.State storage _agent,
        uint64 _valueAMG,
        uint256 _underlyingFeeUBA
    )
        private view
        returns (uint64)
    {
        uint256 poolFeeUBA = _underlyingFeeUBA.mulBips(_agent.poolFeeShareBIPS);
        return _valueAMG + Conversion.convertUBAToAmg(poolFeeUBA);
    }

    function _lastPaymentBlock()
        private view
        returns (uint64 _lastUnderlyingBlock, uint64 _lastUnderlyingTimestamp)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // timeshift amortizes for the time that passed from the last underlying block update
        uint64 timeshift = block.timestamp.toUint64() - state.currentUnderlyingBlockUpdatedAt;
        _lastUnderlyingBlock =
            state.currentUnderlyingBlock + state.settings.underlyingBlocksForPayment;
        _lastUnderlyingTimestamp =
            state.currentUnderlyingBlockTimestamp + timeshift + state.settings.underlyingSecondsForPayment;
    }

    function _reservationFee(
        uint256 amgToTokenWeiPrice,
        uint64 _valueAMG
    )
        private view
        returns (uint256)
    {
        uint256 valueNATWei = Conversion.convertAmgToTokenWei(_valueAMG, amgToTokenWeiPrice);
        return valueNATWei.mulBips(AssetManagerState.getSettings().collateralReservationFeeBIPS);
    }
}
