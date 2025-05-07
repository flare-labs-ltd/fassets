// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interfaces/IIAgentVault.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/Transfers.sol";
import "./data/AssetManagerState.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./Minting.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";
import "./MerkleTree.sol";


library CollateralReservations {
    using SafePct for *;
    using SafeCast for uint256;
    using AgentCollateral for Collateral.CombinedData;
    using Agent for Agent.State;
    using EnumerableSet for EnumerableSet.AddressSet;

    // double hash of empty string (same as _doubleHash("") which cannot be used for constant initialization)
    bytes32 internal constant EMPTY_ADDRESS_DOUBLE_HASH = keccak256(abi.encodePacked(keccak256(bytes(""))));

    function reserveCollateral(
        address _minter,
        address _agentVault,
        uint64 _lots,
        uint64 _maxMintingFeeBIPS,
        address payable _executor,
        string[] calldata _minterUnderlyingAddresses
    )
        internal
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireWhitelistedAgentVaultOwner(agent);
        Collateral.CombinedData memory collateralData = AgentCollateral.combinedData(agent);
        AssetManagerState.State storage state = AssetManagerState.get();
        require(state.mintingPausedAt == 0, "minting paused");
        require(agent.availableAgentsPos != 0 || agent.alwaysAllowedMinters.contains(_minter),
            "agent not in mint queue");
        require(_lots > 0, "cannot mint 0 lots");
        require(agent.status == Agent.Status.NORMAL, "rc: invalid agent status");
        require(collateralData.freeCollateralLots(agent) >= _lots, "not enough free collateral");
        require(_maxMintingFeeBIPS >= agent.feeBIPS, "agent's fee too high");
        uint64 valueAMG = _lots * Globals.getSettings().lotSizeAMG;
        _reserveCollateral(agent, valueAMG + _currentPoolFeeAMG(agent, valueAMG));
        // - only charge reservation fee for public minting, not for alwaysAllowedMinters on non-public agent
        // - poolCollateral is WNat, so we can use its price for calculation of CR fee
        uint256 reservationFee = agent.availableAgentsPos != 0
            ? _reservationFee(collateralData.poolCollateral.amgToTokenWeiPrice, valueAMG)
            : 0;
        require(msg.value >= reservationFee, "inappropriate fee amount");
        // create new crt id - pre-increment, so that id can never be 0
        state.newCrtId += PaymentReference.randomizedIdSkip();
        uint64 crtId = state.newCrtId;
        // create in-memory cr and then put it to storage to not go out-of-stack
        CollateralReservation.Data memory cr;
        cr.valueAMG = valueAMG;
        cr.underlyingFeeUBA = Conversion.convertAmgToUBA(valueAMG).mulBips(agent.feeBIPS).toUint128();
        cr.reservationFeeNatWei = reservationFee.toUint128();
        // 1 is added for backward compatibility where 0 means "value not stored" - it is subtracted when used
        cr.poolFeeShareBIPS = agent.poolFeeShareBIPS + 1;
        cr.agentVault = _agentVault;
        cr.minter = _minter;
        cr.executor = _executor;
        cr.executorFeeNatGWei = ((msg.value - reservationFee) / Conversion.GWEI).toUint64();

        if (agent.handshakeType != 0) {
            require(_minterUnderlyingAddresses.length > 0, "minter underlying addresses required");
            bytes32[] memory hashes = new bytes32[](_minterUnderlyingAddresses.length);
            // double hash the addresses (to prevent second pre-image attack) and check if they are sorted
            hashes[0] = _doubleHash(_minterUnderlyingAddresses[0]);
            require(hashes[0] != EMPTY_ADDRESS_DOUBLE_HASH, "minter underlying address invalid");
            for (uint256 i = 1; i < _minterUnderlyingAddresses.length; i++) {
                hashes[i] = _doubleHash(_minterUnderlyingAddresses[i]);
                require(hashes[i] != EMPTY_ADDRESS_DOUBLE_HASH, "minter underlying address invalid");
                require(hashes[i] > hashes[i - 1], "minter underlying addresses not sorted");
            }
            cr.sourceAddressesRoot = MerkleTree.calculateMerkleRoot(hashes);
            cr.handshakeStartTimestamp = block.timestamp.toUint64();
            _emitHandshakeRequiredEvent(agent, cr, crtId, _minterUnderlyingAddresses);
        } else {
            (uint64 lastUnderlyingBlock, uint64 lastUnderlyingTimestamp) = _lastPaymentBlock();
            cr.firstUnderlyingBlock = state.currentUnderlyingBlock;
            cr.lastUnderlyingBlock = lastUnderlyingBlock;
            cr.lastUnderlyingTimestamp = lastUnderlyingTimestamp;
            _emitCollateralReservationEvent(agent, cr, crtId);
        }
        state.crts[crtId] = cr;
    }

    function approveCollateralReservation(
        uint64 _crtId
    )
        internal
    {
        CollateralReservation.Data storage crt = getCollateralReservation(_crtId);
        Agent.State storage agent = Agent.get(crt.agentVault);
        Agents.requireAgentVaultOwner(agent);
        require(crt.handshakeStartTimestamp != 0, "handshake not required");
        crt.handshakeStartTimestamp = 0;
        (uint64 lastUnderlyingBlock, uint64 lastUnderlyingTimestamp) = _lastPaymentBlock();
        AssetManagerState.State storage state = AssetManagerState.get();
        crt.firstUnderlyingBlock = state.currentUnderlyingBlock;
        crt.lastUnderlyingBlock = lastUnderlyingBlock;
        crt.lastUnderlyingTimestamp = lastUnderlyingTimestamp;
        _emitCollateralReservationEvent(agent, crt, _crtId);
    }

    function rejectCollateralReservation(
        uint64 _crtId
    )
        internal
    {
        CollateralReservation.Data storage crt = getCollateralReservation(_crtId);
        Agent.State storage agent = Agent.get(crt.agentVault);
        Agents.requireAgentVaultOwner(agent);
        require(crt.handshakeStartTimestamp != 0,
            "handshake not required or collateral reservation already approved");
        emit IAssetManagerEvents.CollateralReservationRejected(crt.agentVault, crt.minter, _crtId);
        _rejectOrCancelCollateralReservation(crt, _crtId);
    }

    function cancelCollateralReservation(
        uint64 _crtId
    )
        internal
    {
        CollateralReservation.Data storage crt = getCollateralReservation(_crtId);
        require(crt.minter == msg.sender, "only minter");
        require(crt.handshakeStartTimestamp != 0, "collateral reservation already approved");
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        require(crt.handshakeStartTimestamp + settings.cancelCollateralReservationAfterSeconds <
            block.timestamp, "collateral reservation cancellation too early");
        emit IAssetManagerEvents.CollateralReservationCancelled(crt.agentVault, crt.minter, _crtId);
        _rejectOrCancelCollateralReservation(crt, _crtId);
    }

    function mintingPaymentDefault(
        IReferencedPaymentNonexistence.Proof calldata _nonPayment,
        uint64 _crtId
    )
        internal
    {
        CollateralReservation.Data storage crt = getCollateralReservation(_crtId);
        require(crt.handshakeStartTimestamp == 0, "collateral reservation not approved");
        require(!_nonPayment.data.requestBody.checkSourceAddresses && crt.sourceAddressesRoot == bytes32(0) ||
            _nonPayment.data.requestBody.checkSourceAddresses &&
            crt.sourceAddressesRoot == _nonPayment.data.requestBody.sourceAddressesRoot,
            "invalid check or source addresses root");
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
        uint256 reservedValueUBA = underlyingValueUBA + Minting.calculatePoolFeeUBA(agent, crt);
        emit IAssetManagerEvents.MintingPaymentDefault(crt.agentVault, crt.minter, _crtId, reservedValueUBA);
        // share collateral reservation fee between the agent's vault and pool
        uint256 totalFee = crt.reservationFeeNatWei + crt.executorFeeNatGWei * Conversion.GWEI;
        distributeCollateralReservationFee(agent, totalFee);
        // release agent's reserved collateral
        releaseCollateralReservation(crt, _crtId);  // crt can't be used after this
    }

    function unstickMinting(
        IConfirmedBlockHeightExists.Proof calldata _proof,
        uint64 _crtId
    )
        internal
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        CollateralReservation.Data storage crt = getCollateralReservation(_crtId);
        require(crt.handshakeStartTimestamp == 0, "collateral reservation not approved");
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
        Agents.burnDirectNAT(crt.reservationFeeNatWei + crt.executorFeeNatGWei * Conversion.GWEI);
        // burn reserved collateral at market price
        uint256 amgToTokenWeiPrice = Conversion.currentAmgPriceInTokenWei(agent.vaultCollateralIndex);
        uint256 reservedCollateral = Conversion.convertAmgToTokenWei(crt.valueAMG, amgToTokenWeiPrice);
        Agents.burnVaultCollateral(agent, reservedCollateral);
        // send event
        uint256 reservedValueUBA = Conversion.convertAmgToUBA(crt.valueAMG) + Minting.calculatePoolFeeUBA(agent, crt);
        emit IAssetManagerEvents.CollateralReservationDeleted(crt.agentVault, crt.minter, _crtId, reservedValueUBA);
        // release agent's reserved collateral
        releaseCollateralReservation(crt, _crtId);  // crt can't be used after this
    }

    function distributeCollateralReservationFee(
        Agent.State storage _agent,
        uint256 _fee
    )
        internal
    {
        if (_fee == 0) return;
        uint256 poolFeeShare = _fee.mulBips(_agent.poolFeeShareBIPS);
        _agent.collateralPool.depositNat{value: poolFeeShare}();
        IIAgentVault(_agent.vaultAddress()).depositNat{value: _fee - poolFeeShare}(Globals.getWNat());
    }

    function calculateReservationFee(
        uint64 _lots
    )
        internal view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 amgToTokenWeiPrice = Conversion.currentAmgPriceInTokenWei(state.poolCollateralIndex);
        return _reservationFee(amgToTokenWeiPrice, _lots * settings.lotSizeAMG);
    }

    function releaseCollateralReservation(
        CollateralReservation.Data storage crt,
        uint64 _crtId
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(crt.agentVault);
        uint64 reservationAMG = crt.valueAMG + Conversion.convertUBAToAmg(Minting.calculatePoolFeeUBA(agent, crt));
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
        uint64 _reservationAMG
    )
        private
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Minting.checkMintingCap(_reservationAMG);
        _agent.reservedAMG += _reservationAMG;
        state.totalReservedCollateralAMG += _reservationAMG;
    }

    function _emitHandshakeRequiredEvent(
        Agent.State storage _agent,
        CollateralReservation.Data memory _cr,
        uint64 _crtId,
        string[] calldata _minterUnderlyingAddresses
    )
        private
    {
        emit IAssetManagerEvents.HandshakeRequired(
            _agent.vaultAddress(),
            _cr.minter,
            _crtId,
            _minterUnderlyingAddresses,
            Conversion.convertAmgToUBA(_cr.valueAMG),
            _cr.underlyingFeeUBA);
    }

    function _emitCollateralReservationEvent(
        Agent.State storage _agent,
        CollateralReservation.Data memory _cr,
        uint64 _crtId
    )
        private
    {
        emit IAssetManagerEvents.CollateralReserved(
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

    function _rejectOrCancelCollateralReservation(
        CollateralReservation.Data storage crt,
        uint64 _crtId
    )
        private
    {
        uint256 totalFee = crt.reservationFeeNatWei + crt.executorFeeNatGWei * Conversion.GWEI;
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 returnFee = totalFee.mulBips(settings.rejectOrCancelCollateralReservationReturnFactorBIPS);
        address payable minter = payable(crt.minter);

        // release agent's reserved collateral
        releaseCollateralReservation(crt, _crtId);  // crt can't be used after this

        // guarded against reentrancy in CollateralReservationsFacet
        bool success = Transfers.transferNATAllowFailure(minter, returnFee);
        // if failed, burn the whole fee, otherwise burn the difference
        if (!success) {
            Agents.burnDirectNAT(totalFee);
        } else if (totalFee > returnFee) {
            Agents.burnDirectNAT(totalFee - returnFee);
        }
    }

    function _currentPoolFeeAMG(
        Agent.State storage _agent,
        uint64 _valueAMG
    )
        private view
        returns (uint64)
    {
        uint256 underlyingValueUBA = Conversion.convertAmgToUBA(_valueAMG);
        uint256 poolFeeUBA = Minting.calculateCurrentPoolFeeUBA(_agent, underlyingValueUBA);
        return Conversion.convertUBAToAmg(poolFeeUBA);
    }

    function _lastPaymentBlock()
        private view
        returns (uint64 _lastUnderlyingBlock, uint64 _lastUnderlyingTimestamp)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // timeshift amortizes for the time that passed from the last underlying block update
        uint64 timeshift = block.timestamp.toUint64() - state.currentUnderlyingBlockUpdatedAt;
        uint64 blockshift = (uint256(timeshift) * 1000 / settings.averageBlockTimeMS).toUint64();
        _lastUnderlyingBlock =
            state.currentUnderlyingBlock + blockshift + settings.underlyingBlocksForPayment;
        _lastUnderlyingTimestamp =
            state.currentUnderlyingBlockTimestamp + timeshift + settings.underlyingSecondsForPayment;
    }

    function _reservationFee(
        uint256 amgToTokenWeiPrice,
        uint64 _valueAMG
    )
        private view
        returns (uint256)
    {
        uint256 valueNATWei = Conversion.convertAmgToTokenWei(_valueAMG, amgToTokenWeiPrice);
        return valueNATWei.mulBips(Globals.getSettings().collateralReservationFeeBIPS);
    }

    function _doubleHash(string memory _str)
        private pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(keccak256(bytes(_str))));
    }
}
