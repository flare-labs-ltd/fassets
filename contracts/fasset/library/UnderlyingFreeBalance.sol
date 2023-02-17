// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../generated/interface/IAttestationClient.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./Liquidation.sol";
import "./TransactionAttestation.sol";


library UnderlyingFreeBalance {
    using SignedSafeMath for int256;
    using SafeCast for uint256;
    using SafeCast for int256;
    using PaymentConfirmations for PaymentConfirmations.State;

    function updateFreeBalance(
        address _agentVault,
        int256 _balanceChange
    ) 
        internal
    {
        Agent.State storage agent = Agent.get(_agentVault);
        int256 newBalance = agent.freeUnderlyingBalanceUBA + _balanceChange;
        if (newBalance < 0) {
            emit AMEvents.UnderlyingFreeBalanceNegative(_agentVault, newBalance);
            Liquidation.startFullLiquidation(_agentVault);
        }
        agent.freeUnderlyingBalanceUBA = newBalance.toInt128();
    }

    // Like updateFreeBalance, but it can never make balance negative and trigger liquidation.
    // Separate implementation to avoid circular dependency in liquidation releasing underlying funds.
    function increaseFreeBalance(
        address _agentVault,
        uint256 _balanceIncrease
    ) 
        internal
    {
        Agent.State storage agent = Agent.get(_agentVault);
        int256 newBalance = agent.freeUnderlyingBalanceUBA + _balanceIncrease.toInt256();
        agent.freeUnderlyingBalanceUBA = newBalance.toInt128();
    }

    function confirmTopupPayment(
        IAttestationClient.Payment calldata _payment,
        address _agentVault
    )
        external
    {
        Agents.requireAgentVaultOwner(_agentVault);
        Agent.State storage agent = Agent.get(_agentVault);
        AssetManagerState.State storage state = AssetManagerState.get();
        TransactionAttestation.verifyPaymentSuccess(_payment);
        require(_payment.receivingAddressHash == agent.underlyingAddressHash, 
            "not underlying address");
        require(_payment.paymentReference == PaymentReference.topup(_agentVault),
            "not a topup payment");
        require(_payment.blockNumber >= agent.underlyingBlockAtCreation,
            "topup before agent created");
        state.paymentConfirmations.confirmIncomingPayment(_payment);
        uint256 amountUBA = SafeCast.toUint256(_payment.receivedAmount);
        increaseFreeBalance(_agentVault, amountUBA);
        emit AMEvents.UnderlyingBalanceToppedUp(_agentVault, amountUBA);
    }
}
