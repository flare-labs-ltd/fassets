// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../../generated/interface/IAttestationClient.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./CollateralReservations.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";


library Minting {
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentConfirmations for PaymentConfirmations.State;
    using AgentCollateral for Collateral.CombinedData;
    
    function executeMinting(
        AssetManagerState.State storage _state,
        IAttestationClient.Payment calldata _payment,
        uint64 _crtId
    )
        external
    {
        CollateralReservation.Data storage crt = 
            CollateralReservations.getCollateralReservation(_state, _crtId);
        address agentVault = crt.agentVault;
        Agent.State storage agent = Agents.getAgent(_state, agentVault);
        // verify transaction
        TransactionAttestation.verifyPaymentSuccess(_state.settings, _payment);
        // minter or agent can present the proof - agent may do it to unlock the collateral if minter
        // becomes unresponsive
        require(msg.sender == crt.minter || msg.sender == Agents.vaultOwner(agentVault), 
            "only minter or agent");
        require(_payment.paymentReference == PaymentReference.minting(_crtId),
            "invalid minting reference");
        require(_payment.receivingAddressHash == agent.underlyingAddressHash, 
            "not minting agent's address");
        uint256 receivedAmount = SafeCast.toUint256(_payment.receivedAmount);
        uint256 mintValueUBA = Conversion.convertAmgToUBA(_state.settings, crt.valueAMG);
        require(receivedAmount >= mintValueUBA + crt.underlyingFeeUBA,
            "minting payment too small");
        // we do not allow payments before the underlying block at requests, because the payer should have guessed
        // the payment reference, which is good for nothing except attack attempts
        require(_payment.blockNumber >= crt.firstUnderlyingBlock,
            "minting payment too old");
        // execute minting
        _performMinting(_state, agent, _crtId, agentVault, crt.minter, crt.valueAMG, 
            receivedAmount, crt.underlyingFeeUBA);
        // burn collateral reservation fee (guarded against reentrancy in AssetManager.executeMinting)
        _state.settings.burnAddress.transfer(crt.reservationFeeNatWei);
        // cleanup
        CollateralReservations.releaseCollateralReservation(_state, crt, _crtId);   // crt can't be used after this
    }
    
    function selfMint(
        AssetManagerState.State storage _state,
        IAttestationClient.Payment calldata _payment,
        address _agentVault,
        uint64 _lots
    )
        external
    {
        Agent.State storage agent = Agents.getAgent(_state, _agentVault);
        Collateral.CombinedData memory collateralData = AgentCollateral.combinedData(_state, agent, _agentVault);
        Agents.requireAgentVaultOwner(_agentVault);
        assert(agent.agentType == Agent.Type.AGENT_100); // AGENT_0 not supported yet
        TransactionAttestation.verifyPaymentSuccess(_state.settings, _payment);
        require(_state.pausedAt == 0, "minting paused");
        require(agent.status == Agent.Status.NORMAL, "self-mint invalid agent status");
        require(collateralData.freeCollateralLots(_state, agent) >= _lots, "not enough free collateral");
        uint64 valueAMG = _lots * _state.settings.lotSizeAMG;
        checkMintingCap(_state, valueAMG);
        uint256 mintValueUBA = Conversion.convertAmgToUBA(_state.settings, valueAMG);
        require(_payment.paymentReference == PaymentReference.selfMint(_agentVault), 
            "invalid self-mint reference");
        require(_payment.receivingAddressHash == agent.underlyingAddressHash, 
            "self-mint not agent's address");
        require(_payment.receivedAmount >= 0 && uint256(_payment.receivedAmount) >= mintValueUBA,
            "self-mint payment too small");
        require(_payment.blockNumber >= agent.underlyingBlockAtCreation,
            "self-mint payment too old");
        _state.paymentConfirmations.confirmIncomingPayment(_payment);
        // case _lots==0 is allowed for self minting because if lot size increases between the underlying payment
        // and selfMint call, the paid assets would otherwise be stuck; in this way they are converted to free balance
        uint256 receivedAmount = uint256(_payment.receivedAmount);  // guarded by reuquire
        if (_lots > 0) {
            uint256 standardFee = SafeBips.mulBips(valueAMG, agent.feeBIPS);
            _performMinting(_state, agent, 0, _agentVault, msg.sender, valueAMG, receivedAmount, standardFee);
        } else {
            UnderlyingFreeBalance.increaseFreeBalance(_state, _agentVault, receivedAmount);
            emit AMEvents.MintingExecuted(_agentVault, 0, 0, 0, receivedAmount, 0);
        }
    }

    function checkMintingCap(
        AssetManagerState.State storage _state, 
        uint64 _increaseAMG
    )
        internal view
    {
        uint256 totalMintedUBA = IERC20(address(_state.settings.fAsset)).totalSupply();
        uint256 totalAMG = _state.totalReservedCollateralAMG + 
            Conversion.convertUBAToAmg(_state.settings, totalMintedUBA);
        require(totalAMG + _increaseAMG <= _state.settings.mintingCapAMG, "minting cap exceeded");
    }

    function _performMinting(
        AssetManagerState.State storage _state,
        Agent.State storage _agent,
        uint64 _crtId,
        address _agentVault,
        address _minter,
        uint64 _mintValueAMG,
        uint256 _receivedAmountUBA,
        uint256 _feeUBA
    ) 
        private
    {
        // Add pool fee to dust (usually less than 1 lot), but if dust exceeds 1 lot, add as much as possible 
        // to the created ticket. At the end, there will always be less than 1 lot of dust left.
        uint64 poolFeeAMG = Conversion.convertUBAToAmg(_state.settings, 
            SafeBips.mulBips(_feeUBA, _agent.poolFeeShareBIPS));
        uint64 newDustAMG = _agent.dustAMG + poolFeeAMG;
        uint64 ticketValueAMG = _mintValueAMG;
        if (newDustAMG >= _state.settings.lotSizeAMG) {
            uint64 remainder = newDustAMG % _state.settings.lotSizeAMG;
            ticketValueAMG += newDustAMG - remainder;
            newDustAMG = remainder;
        }
        // create ticket and change dust
        Agents.allocateMintedAssets(_state, _agentVault, _mintValueAMG + poolFeeAMG);
        uint64 redemptionTicketId = _state.redemptionQueue.createRedemptionTicket(_agentVault, ticketValueAMG);
        Agents.changeDust(_state, _agentVault, newDustAMG);
        // update agent free balance with agent's fee
        uint256 mintValueUBA = Conversion.convertAmgToUBA(_state.settings, _mintValueAMG);
        uint256 poolFeeUBA = Conversion.convertAmgToUBA(_state.settings, poolFeeAMG);
        uint256 agentFeeUBA = _receivedAmountUBA - mintValueUBA - poolFeeUBA;
        UnderlyingFreeBalance.increaseFreeBalance(_state, _agentVault, agentFeeUBA);
        // perform minting
        _state.settings.fAsset.mint(_minter, mintValueUBA);
        _state.settings.fAsset.mint(address(_agent.collateralPool), poolFeeUBA);
        // notify
        emit AMEvents.MintingExecuted(_agentVault, _crtId, redemptionTicketId, mintValueUBA, agentFeeUBA, poolFeeUBA);
    }
}
