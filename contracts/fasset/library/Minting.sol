// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../../generated/interface/IAttestationClient.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./CollateralReservations.sol";
import "./AssetManagerState.sol";
import "./AgentCollateral.sol";
import "./PaymentReference.sol";
import "./TransactionAttestation.sol";


library Minting {
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentConfirmations for PaymentConfirmations.State;
    using AgentCollateral for AgentCollateral.Data;
    
    function mintingExecuted(
        AssetManagerState.State storage _state,
        IAttestationClient.Payment calldata _payment,
        uint64 _crtId
    )
        external
        returns (address _minter, uint256 _mintValueUBA)
    {
        CollateralReservations.CollateralReservation storage crt = 
            CollateralReservations.getCollateralReservation(_state, _crtId);
        _minter = crt.minter;
        _mintValueUBA = Conversion.convertAmgToUBA(_state.settings, crt.valueAMG);
        address agentVault = crt.agentVault;
        Agents.Agent storage agent = Agents.getAgent(_state, agentVault);
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
        require(receivedAmount >= _mintValueUBA + crt.underlyingFeeUBA,
            "minting payment too small");
        // we do not allow payments before the underlying block at requests, because the payer should have guessed
        // the payment reference, which is good for nothing except attack attempts
        require(_payment.blockNumber >= crt.firstUnderlyingBlock,
            "minting payment too old");
        uint64 redemptionTicketId = _state.redemptionQueue.createRedemptionTicket(agentVault, crt.valueAMG);
        uint256 receivedFeeUBA = receivedAmount - _mintValueUBA;
        emit AMEvents.MintingExecuted(agentVault, _crtId, redemptionTicketId, _mintValueUBA, receivedFeeUBA);
        Agents.allocateMintedAssets(_state, agentVault, crt.valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_state, agentVault, receivedFeeUBA);
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
        returns (uint256 _mintValueUBA)
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, agent, _agentVault);
        Agents.requireAgentVaultOwner(_agentVault);
        assert(agent.agentType == Agents.AgentType.AGENT_100); // AGENT_0 not supported yet
        TransactionAttestation.verifyPaymentSuccess(_state.settings, _payment);
        require(_state.pausedAt == 0, "minting paused");
        require(agent.status == Agents.AgentStatus.NORMAL, "self-mint invalid agent status");
        require(collateralData.freeCollateralLots(agent, _state.settings) >= _lots, "not enough free collateral");
        uint64 valueAMG = _lots * _state.settings.lotSizeAMG;
        _mintValueUBA = Conversion.convertAmgToUBA(_state.settings, valueAMG);
        require(_payment.paymentReference == PaymentReference.selfMint(_agentVault), 
            "invalid self-mint reference");
        require(_payment.receivingAddressHash == agent.underlyingAddressHash, 
            "self-mint not agent's address");
        require(_payment.receivedAmount >= 0 && uint256(_payment.receivedAmount) >= _mintValueUBA,
            "self-mint payment too small");
        require(_payment.blockNumber >= agent.underlyingBlockAtCreation,
            "self-mint payment too old");
        _state.paymentConfirmations.confirmIncomingPayment(_payment);
        // case _lots==0 is allowed for self minting because if lot size increases between the underlying payment
        // and selfMint call, the paid assets would otherwise be stuck; in this way they are converted to free balance
        uint64 redemptionTicketId = 0;
        if (_lots > 0) {
            redemptionTicketId = _state.redemptionQueue.createRedemptionTicket(_agentVault, valueAMG);
        }
        uint256 receivedFeeUBA = uint256(_payment.receivedAmount) - _mintValueUBA;  // guarded by require
        emit AMEvents.MintingExecuted(_agentVault, 0, redemptionTicketId, _mintValueUBA, receivedFeeUBA);
        Agents.allocateMintedAssets(_state, _agentVault, valueAMG);
        if (receivedFeeUBA > 0) {
            UnderlyingFreeBalance.increaseFreeBalance(_state, _agentVault, receivedFeeUBA);
        }
    }
}
