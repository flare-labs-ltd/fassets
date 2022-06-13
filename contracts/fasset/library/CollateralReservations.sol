// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "./Conversion.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./AssetManagerState.sol";
import "../interface/IAgentVault.sol";
import "./AgentCollateral.sol";
import "./PaymentReference.sol";
import "./TransactionAttestation.sol";


library CollateralReservations {
    using SafeBips for uint256;
    using AgentCollateral for AgentCollateral.Data;
    
    struct CollateralReservation {
        uint64 valueAMG;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
        uint64 lastUnderlyingTimestamp;
        uint128 underlyingFeeUBA;
        uint128 reservationFeeNatWei;
        address agentVault;
        address minter;
    }
    
    function reserveCollateral(
        AssetManagerState.State storage _state, 
        address _minter,
        address _agentVault,
        uint64 _lots,
        uint64 _maxMintingFeeBIPS
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, _agentVault);
        require(_state.pausedAt == 0, "minting paused");
        require(agent.availableAgentsPos != 0, "agent not in mint queue");
        require(_lots > 0, "cannot mint 0 lots");
        require(agent.status == Agents.AgentStatus.NORMAL, "rc: invalid agent status");
        require(collateralData.freeCollateralLots(agent, _state.settings) >= _lots, "not enough free collateral");
        require(_maxMintingFeeBIPS >= agent.feeBIPS, "agent's fee too high");
        uint64 valueAMG = _lots * _state.settings.lotSizeAMG;
        agent.reservedAMG += valueAMG;
        uint256 underlyingValueUBA = Conversion.convertAmgToUBA(_state.settings, valueAMG);
        uint256 underlyingFeeUBA = underlyingValueUBA.mulBips(agent.feeBIPS);
        uint256 reservationFee = _reservationFee(_state, collateralData.amgToNATWeiPrice, valueAMG);
        require(msg.value == reservationFee, "inappropriate fee amount");
        (uint64 lastUnderlyingBlock, uint64 lastUnderlyingTimestamp) = _lastPaymentBlock(_state);
        uint64 crtId = ++_state.newCrtId;   // pre-increment - id can never be 0
        _state.crts[crtId] = CollateralReservation({
            valueAMG: valueAMG,
            underlyingFeeUBA: SafeCast.toUint128(underlyingFeeUBA),
            reservationFeeNatWei: SafeCast.toUint128(reservationFee),
            agentVault: _agentVault,
            minter: _minter,
            firstUnderlyingBlock: _state.currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock,
            lastUnderlyingTimestamp: lastUnderlyingTimestamp
        });
        // stack too deep error if used directly in emitted event
        string storage paymentAddress = agent.underlyingAddressString;
        emit AMEvents.CollateralReserved(_agentVault,
            _minter,
            crtId,
            underlyingValueUBA,
            underlyingFeeUBA, 
            lastUnderlyingBlock,
            lastUnderlyingTimestamp,
            paymentAddress,
            PaymentReference.minting(crtId));
    }
    
    function mintingPaymentDefault(
        AssetManagerState.State storage _state, 
        IAttestationClient.ReferencedPaymentNonexistence calldata _nonPayment,
        uint64 _crtId
    )
        external
    {
        CollateralReservations.CollateralReservation storage crt = getCollateralReservation(_state, _crtId);
        Agents.Agent storage agent = Agents.getAgent(_state, crt.agentVault);
        // check requirements
        TransactionAttestation.verifyReferencedPaymentNonexistence(_state.settings, _nonPayment);
        uint256 underlyingValueUBA = Conversion.convertAmgToUBA(_state.settings, crt.valueAMG);
        require(_nonPayment.paymentReference == PaymentReference.minting(_crtId) &&
            _nonPayment.destinationAddressHash == agent.underlyingAddressHash &&
            _nonPayment.amount == underlyingValueUBA + crt.underlyingFeeUBA,
            "minting non-payment mismatch");
        require(_nonPayment.firstOverflowBlockNumber > crt.lastUnderlyingBlock && 
            _nonPayment.firstOverflowBlockTimestamp > crt.lastUnderlyingTimestamp, 
            "minting default too early");
        require(_nonPayment.lowerBoundaryBlockNumber <= crt.firstUnderlyingBlock,
            "minting request too old");
        Agents.requireAgentVaultOwner(crt.agentVault);
        // send event
        emit AMEvents.MintingPaymentDefault(crt.agentVault, crt.minter, _crtId);
        // transfer crt fee to the agent's vault
        IAgentVault(crt.agentVault).deposit{value: crt.reservationFeeNatWei}();
        // release agent's reserved collateral
        releaseCollateralReservation(_state, crt, _crtId);  // crt can't be used after this
    }
    
    function unstickMinting(
        AssetManagerState.State storage _state,
        IAttestationClient.ConfirmedBlockHeightExists calldata _proof,
        uint64 _crtId
    )
        external
    {
        CollateralReservations.CollateralReservation storage crt = getCollateralReservation(_state, _crtId);
        Agents.requireAgentVaultOwner(crt.agentVault);
        // verify proof
        TransactionAttestation.verifyConfirmedBlockHeightExists(_state.settings, _proof);
        // enough time must pass so that proofs are no longer available
        require(_proof.lowestQueryWindowBlockNumber > crt.lastUnderlyingBlock
            && _proof.lowestQueryWindowBlockTimestamp > crt.lastUnderlyingTimestamp,
            "cannot unstick minting yet");
        // burn collateral reservation fee (guarded against reentrancy in AssetManager.unstickMinting)
        _state.settings.burnAddress.transfer(crt.reservationFeeNatWei);
        // burn reserved collateral at market price
        uint256 amgToNATWeiPrice = Conversion.currentAmgToNATWeiPrice(_state.settings);
        uint256 reservedCollateral = Conversion.convertAmgToNATWei(crt.valueAMG, amgToNATWeiPrice);
        Agents.burnCollateral(_state, crt.agentVault, reservedCollateral);
        // send event
        emit AMEvents.CollateralReservationDeleted(crt.agentVault, crt.minter, _crtId);
        // release agent's reserved collateral
        releaseCollateralReservation(_state, crt, _crtId);  // crt can't be used after this
    }
    
    function calculateReservationFee(
        AssetManagerState.State storage _state,
        uint64 _lots
    )
        external view
        returns (uint256)
    {
        uint256 amgToNATWeiPrice = Conversion.currentAmgToNATWeiPrice(_state.settings);
        return _reservationFee(_state, amgToNATWeiPrice, _lots * _state.settings.lotSizeAMG);
    }
    
    function releaseCollateralReservation(
        AssetManagerState.State storage _state,
        CollateralReservations.CollateralReservation storage crt,
        uint64 _crtId
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, crt.agentVault);
        agent.reservedAMG = SafeMath64.sub64(agent.reservedAMG, crt.valueAMG, "invalid reservation");
        delete _state.crts[_crtId];
    }

    function getCollateralReservation(
        AssetManagerState.State storage _state, 
        uint64 _crtId
    ) 
        internal view
        returns (CollateralReservation storage) 
    {
        require(_crtId > 0 && _state.crts[_crtId].valueAMG != 0, "invalid crt id");
        return _state.crts[_crtId];
    }
    
    function _lastPaymentBlock(AssetManagerState.State storage _state)
        private view
        returns (uint64 _lastUnderlyingBlock, uint64 _lastUnderlyingTimestamp)
    {
        // timeshift amortizes for the time that passed from the last underlying block update
        uint64 timeshift = 
            SafeCast.toUint64(block.timestamp) - _state.currentUnderlyingBlockUpdatedAt;
        _lastUnderlyingBlock =
            _state.currentUnderlyingBlock + _state.settings.underlyingBlocksForPayment;
        _lastUnderlyingTimestamp = 
            _state.currentUnderlyingBlockTimestamp + timeshift + _state.settings.underlyingSecondsForPayment;
    }

    function _reservationFee(
        AssetManagerState.State storage _state,
        uint256 amgToNATWeiPrice,
        uint64 _valueAMG
    )
        private view
        returns (uint256)
    {
        uint256 valueNATWei = Conversion.convertAmgToNATWei(_valueAMG, amgToNATWeiPrice); 
        return SafeBips.mulBips(valueNATWei, _state.settings.collateralReservationFeeBIPS);
    }
}
