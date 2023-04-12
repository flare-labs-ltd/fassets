// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../generated/interface/IAttestationClient.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/MathUtils.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./Liquidation.sol";
import "./TransactionAttestation.sol";


library UnderlyingBalance {
    using SafeMath for uint256;
    using SafeCast for *;
    using SafePct for *;
    using PaymentConfirmations for PaymentConfirmations.State;
    using Agent for Agent.State;

    function confirmTopupPayment(
        IAttestationClient.Payment calldata _payment,
        address _agentVault
    )
        external
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Agents.requireAgentVaultOwner(_agentVault);
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
        increaseBalance(agent, amountUBA.toUint128());
        emit AMEvents.UnderlyingBalanceToppedUp(_agentVault, amountUBA);
    }

    function updateBalance(
        Agent.State storage _agent,
        int256 _balanceChange
    )
        internal
    {
        uint256 newBalance = MathUtils.positivePart(_agent.underlyingBalanceUBA.toInt256() + _balanceChange);
        uint256 requiredBalance = requiredUnderlyingUBA(_agent);
        if (newBalance < requiredBalance) {
            emit AMEvents.UnderlyingBalanceTooLow(_agent.vaultAddress(), newBalance, requiredBalance);
            Liquidation.startFullLiquidation(_agent);
        }
        _agent.underlyingBalanceUBA = newBalance.toUint128();
    }

    // Like updateBalance, but it can never make balance negative and trigger liquidation.
    // Separate implementation to avoid dependency on liquidation for balance increases.
    function increaseBalance(
        Agent.State storage _agent,
        uint256 _balanceIncrease
    )
        internal
    {
        _agent.underlyingBalanceUBA += _balanceIncrease.toUint128();
    }

    // Underlying balance not backing anything (can be used for gas/fees or withdrawn after announcement).
    function freeUnderlyingUBA(Agent.State storage _agent)
        internal view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 backedUBA = uint256(_agent.mintedAMG + _agent.underlyingRedeemingAMG) *
            settings.assetMintingGranularityUBA;
        uint256 lockedUBA = backedUBA.mulBips(settings.minUnderlyingBackingBIPS);
        (, uint256 freeUBA) = uint256(_agent.underlyingBalanceUBA).trySub(lockedUBA);
        return freeUBA;
    }

    // The minimum underlying balance that has to be held by the agent. Below this, agent is liquidated.
    function requiredUnderlyingUBA(Agent.State storage _agent)
        internal view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 backedUBA = uint256(_agent.mintedAMG) * settings.assetMintingGranularityUBA;
        return backedUBA.mulBips(settings.minUnderlyingBackingBIPS);
    }
}
