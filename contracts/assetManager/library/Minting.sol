// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "flare-smart-contracts-v2/contracts/userInterfaces/IFdcVerification.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/Transfers.sol";
import "./data/AssetManagerState.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "./Agents.sol";
import "./UnderlyingBalance.sol";
import "./CollateralReservations.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";

library Minting {
    using SafePct for *;
    using SafeCast for *;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentConfirmations for PaymentConfirmations.State;
    using AgentCollateral for Collateral.CombinedData;
    using Agent for Agent.State;

    enum MintingType { PUBLIC, SELF_MINT, FROM_FREE_UNDERLYING }

    function executeMinting(
        IPayment.Proof calldata _payment,
        uint64 _crtId
    )
        internal
    {
        CollateralReservation.Data storage crt = CollateralReservations.getCollateralReservation(_crtId);
        require(crt.handshakeStartTimestamp == 0, "collateral reservation not approved");
        Agent.State storage agent = Agent.get(crt.agentVault);
        // verify transaction
        TransactionAttestation.verifyPaymentSuccess(_payment);
        // minter or agent can present the proof - agent may do it to unlock the collateral if minter
        // becomes unresponsive
        require(msg.sender == crt.minter || msg.sender == crt.executor || Agents.isOwner(agent, msg.sender),
            "only minter, executor or agent");
        require(_payment.data.responseBody.standardPaymentReference == PaymentReference.minting(_crtId),
            "invalid minting reference");
        require(_payment.data.responseBody.receivingAddressHash == agent.underlyingAddressHash,
            "not minting agent's address");
        require(crt.sourceAddressesRoot == bytes32(0) ||
                crt.sourceAddressesRoot == _payment.data.responseBody.sourceAddressesRoot, // handshake was required
            "invalid minter underlying addresses root");
        uint256 mintValueUBA = Conversion.convertAmgToUBA(crt.valueAMG);
        require(_payment.data.responseBody.receivedAmount >= SafeCast.toInt256(mintValueUBA + crt.underlyingFeeUBA),
            "minting payment too small");
        // we do not allow payments before the underlying block at requests, because the payer should have guessed
        // the payment reference, which is good for nothing except attack attempts
        require(_payment.data.responseBody.blockNumber >= crt.firstUnderlyingBlock,
            "minting payment too old");
        // mark payment used
        AssetManagerState.get().paymentConfirmations.confirmIncomingPayment(_payment);
        // execute minting
        _performMinting(agent, MintingType.PUBLIC, _crtId, crt.minter, crt.valueAMG,
            uint256(_payment.data.responseBody.receivedAmount), calculatePoolFee(agent, crt));
        // pay to executor if they called this method
        uint256 unclaimedExecutorFee = crt.executorFeeNatGWei * Conversion.GWEI;
        if (msg.sender == crt.executor) {
            // safe - 1) guarded by nonReentrant in AssetManager.executeMinting, 2) recipient is msg.sender
            Transfers.transferNAT(crt.executor, unclaimedExecutorFee);
            unclaimedExecutorFee = 0;
        }
        // burn collateral reservation fee (guarded against reentrancy in AssetManager.executeMinting)
        CollateralReservations.distributeCollateralReservationFee(agent,
            crt.reservationFeeNatWei + unclaimedExecutorFee);
        // cleanup
        CollateralReservations.releaseCollateralReservation(crt, _crtId);   // crt can't be used after this
    }

    function selfMint(
        IPayment.Proof calldata _payment,
        address _agentVault,
        uint64 _lots
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireAgentVaultOwner(agent);
        Agents.requireWhitelistedAgentVaultOwner(agent);
        Collateral.CombinedData memory collateralData = AgentCollateral.combinedData(agent);
        TransactionAttestation.verifyPaymentSuccess(_payment);
        require(state.mintingPausedAt == 0, "minting paused");
        require(agent.status == Agent.Status.NORMAL, "self-mint invalid agent status");
        require(collateralData.freeCollateralLots(agent) >= _lots, "not enough free collateral");
        uint64 valueAMG = _lots * Globals.getSettings().lotSizeAMG;
        checkMintingCap(valueAMG);
        uint256 mintValueUBA = Conversion.convertAmgToUBA(valueAMG);
        uint256 poolFeeUBA = calculateCurrentPoolFee(agent, mintValueUBA);
        require(_payment.data.responseBody.standardPaymentReference == PaymentReference.selfMint(_agentVault),
            "invalid self-mint reference");
        require(_payment.data.responseBody.receivingAddressHash == agent.underlyingAddressHash,
            "self-mint not agent's address");
        require(_payment.data.responseBody.receivedAmount >= SafeCast.toInt256(mintValueUBA + poolFeeUBA),
            "self-mint payment too small");
        require(_payment.data.responseBody.blockNumber >= agent.underlyingBlockAtCreation,
            "self-mint payment too old");
        state.paymentConfirmations.confirmIncomingPayment(_payment);
        // case _lots==0 is allowed for self minting because if lot size increases between the underlying payment
        // and selfMint call, the paid assets would otherwise be stuck; in this way they are converted to free balance
        uint256 receivedAmount = uint256(_payment.data.responseBody.receivedAmount);  // guarded by require
        if (_lots > 0) {
            _performMinting(agent, MintingType.SELF_MINT, 0, msg.sender, valueAMG, receivedAmount, poolFeeUBA);
        } else {
            UnderlyingBalance.increaseBalance(agent, receivedAmount);
            emit IAssetManagerEvents.SelfMint(_agentVault, false, 0, receivedAmount, 0);
        }
    }

    function mintFromFreeUnderlying(
        address _agentVault,
        uint64 _lots
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireAgentVaultOwner(agent);
        Agents.requireWhitelistedAgentVaultOwner(agent);
        Collateral.CombinedData memory collateralData = AgentCollateral.combinedData(agent);
        require(state.mintingPausedAt == 0, "minting paused");
        require(agent.status == Agent.Status.NORMAL, "self-mint invalid agent status");
        require(collateralData.freeCollateralLots(agent) >= _lots, "not enough free collateral");
        uint64 valueAMG = _lots * Globals.getSettings().lotSizeAMG;
        checkMintingCap(valueAMG);
        uint256 mintValueUBA = Conversion.convertAmgToUBA(valueAMG);
        uint256 poolFeeUBA = calculateCurrentPoolFee(agent, mintValueUBA);
        uint256 requiredUnderlyingAfter = UnderlyingBalance.requiredUnderlyingUBA(agent) + mintValueUBA + poolFeeUBA;
        require(requiredUnderlyingAfter.toInt256() <= agent.underlyingBalanceUBA, "free underlying balance to small");
        _performMinting(agent, MintingType.FROM_FREE_UNDERLYING, 0, msg.sender, valueAMG, 0, poolFeeUBA);
    }

    function checkMintingCap(
        uint64 _increaseAMG
    )
        internal view
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint256 mintingCapAMG = settings.mintingCapAMG;
        if (mintingCapAMG == 0) return;     // minting cap disabled
        uint256 totalMintedUBA = IERC20(settings.fAsset).totalSupply();
        uint256 totalAMG = state.totalReservedCollateralAMG + Conversion.convertUBAToAmg(totalMintedUBA);
        require(totalAMG + _increaseAMG <= mintingCapAMG, "minting cap exceeded");
    }

    function calculatePoolFee(
        Agent.State storage _agent,
        CollateralReservation.Data storage _crt
    )
        internal view
        returns (uint256)
    {
        // After an upgrade, poolFeeShareBIPS is stored in the collateral reservation.
        // To allow for backward compatibility, value 0 in this field indicates use of old _agent.poolFeeShareBIPS.
        uint16 storedPoolFeeShareBIPS = _crt.poolFeeShareBIPS;
        uint16 poolFeeShareBIPS = storedPoolFeeShareBIPS > 0 ? storedPoolFeeShareBIPS - 1 : _agent.poolFeeShareBIPS;
        return _calculatePoolFee(_crt.underlyingFeeUBA, poolFeeShareBIPS);
    }

    function calculateCurrentPoolFee(
        Agent.State storage _agent,
        uint256 _mintingValueUBA
    )
        internal view
        returns (uint256)
    {
        uint256 mintingFeeUBA = _mintingValueUBA.mulBips(_agent.feeBIPS);
        return _calculatePoolFee(mintingFeeUBA, _agent.poolFeeShareBIPS);
    }

    function _calculatePoolFee(
        uint256 _mintingFee,
        uint16 _poolFeeShareBIPS
    )
        private view
        returns (uint256)
    {
        // round to whole number of amg's to avoid rounding errors after minting (minted amount is in amg)
        return Conversion.roundUBAToAmg(_mintingFee.mulBips(_poolFeeShareBIPS));
    }

    function _performMinting(
        Agent.State storage _agent,
        MintingType _mintingType,
        uint64 _crtId,
        address _minter,
        uint64 _mintValueAMG,
        uint256 _receivedAmountUBA,
        uint256 _poolFeeUBA
    )
        private
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // Add pool fee to dust (usually less than 1 lot), but if dust exceeds 1 lot, add as much as possible
        // to the created ticket. At the end, there will always be less than 1 lot of dust left.
        uint64 poolFeeAMG = Conversion.convertUBAToAmg(_poolFeeUBA);
        uint64 newDustAMG = _agent.dustAMG + poolFeeAMG;
        uint64 ticketValueAMG = _mintValueAMG;
        if (newDustAMG >= settings.lotSizeAMG) {
            uint64 remainder = newDustAMG % settings.lotSizeAMG;
            ticketValueAMG += newDustAMG - remainder;
            newDustAMG = remainder;
        }
        // create ticket and change dust
        Agents.allocateMintedAssets(_agent, _mintValueAMG + poolFeeAMG);
        Agents.createRedemptionTicket(_agent, ticketValueAMG);
        Agents.changeDust(_agent, newDustAMG);
        // update agent balance with deposited amount (received amount is 0 in mintFromFreeUnderlying)
        UnderlyingBalance.increaseBalance(_agent, _receivedAmountUBA);
        // perform minting
        uint256 mintValueUBA = Conversion.convertAmgToUBA(_mintValueAMG);
        Globals.getFAsset().mint(_minter, mintValueUBA);
        Globals.getFAsset().mint(address(_agent.collateralPool), _poolFeeUBA);
        _agent.collateralPool.fAssetFeeDeposited(_poolFeeUBA);
        // notify
        if (_mintingType == MintingType.PUBLIC) {
            uint256 agentFeeUBA = _receivedAmountUBA - mintValueUBA - _poolFeeUBA;
            emit IAssetManagerEvents.MintingExecuted(_agent.vaultAddress(), _crtId,
                mintValueUBA, agentFeeUBA, _poolFeeUBA);
        } else {
            bool fromFreeUnderlying = _mintingType == MintingType.FROM_FREE_UNDERLYING;
            emit IAssetManagerEvents.SelfMint(_agent.vaultAddress(), fromFreeUnderlying,
                mintValueUBA, _receivedAmountUBA, _poolFeeUBA);
        }
    }
}
