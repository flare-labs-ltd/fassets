// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../../generated/interface/ISCProofVerifier.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Redemptions.sol";
import "./Conversion.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";


library RedemptionFailures {
    using SafePct for *;
    using Agent for Agent.State;
    using AgentCollateral for Collateral.Data;

    function redemptionPaymentDefault(
        ISCProofVerifier.ReferencedPaymentNonexistence calldata _nonPayment,
        uint64 _redemptionRequestId
    )
        external
    {
        Redemption.Request storage request = Redemptions.getRedemptionRequest(_redemptionRequestId);
        Agent.State storage agent = Agent.get(request.agentVault);
        require(request.status == Redemption.Status.ACTIVE, "invalid redemption status");
        // verify transaction
        TransactionAttestation.verifyReferencedPaymentNonexistence(_nonPayment);
        // check non-payment proof
        require(_nonPayment.paymentReference == PaymentReference.redemption(_redemptionRequestId) &&
            _nonPayment.destinationAddressHash == request.redeemerUnderlyingAddressHash &&
            _nonPayment.amount == request.underlyingValueUBA - request.underlyingFeeUBA,
            "redemption non-payment mismatch");
        require(_nonPayment.firstOverflowBlockNumber > request.lastUnderlyingBlock &&
            _nonPayment.firstOverflowBlockTimestamp > request.lastUnderlyingTimestamp,
            "redemption default too early");
        require(_nonPayment.lowerBoundaryBlockNumber <= request.firstUnderlyingBlock,
            "redemption request too old");
        // We allow only redeemers or agents to trigger redemption default, since they may want
        // to do it at some particular time. (Agent might want to call default to unstick redemption when
        // the redeemer is unresponsive.)
        require(msg.sender == request.redeemer || Agents.isOwner(agent, msg.sender),
            "only redeemer or agent");
        // pay redeemer in native currency and mark as defaulted
        executeDefaultPayment(agent, request, _redemptionRequestId);
        // don't delete redemption request at end - the agent might still confirm failed payment
        request.status = Redemption.Status.DEFAULTED;
    }

    function finishRedemptionWithoutPayment(
        ISCProofVerifier.ConfirmedBlockHeightExists calldata _proof,
        uint64 _redemptionRequestId
    )
        external
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        Redemption.Request storage request = Redemptions.getRedemptionRequest(_redemptionRequestId);
        Agent.State storage agent = Agent.get(request.agentVault);
        Agents.requireAgentVaultOwner(agent);
        // the request should have been defaulted by providing a non-payment proof to redemptionPaymentDefault(),
        // except in very rare case when both agent and redeemer cannot perform confirmation while the attestation
        // is still available (~ 1 day) - in this case the agent can perform default without proof
        if (request.status == Redemption.Status.ACTIVE) {
            // verify proof
            TransactionAttestation.verifyConfirmedBlockHeightExists(_proof);
            // if non-payment proof is still available, should use redemptionPaymentDefault() instead
            // (the last inequality tests that the query window in proof is at least as big as configured)
            require(_proof.lowestQueryWindowBlockNumber > request.lastUnderlyingBlock
                && _proof.lowestQueryWindowBlockTimestamp > request.lastUnderlyingTimestamp
                && _proof.lowestQueryWindowBlockTimestamp + settings.attestationWindowSeconds <= _proof.blockTimestamp,
                "should default first");
            executeDefaultPayment(agent, request, _redemptionRequestId);
        }
        // delete redemption request - not needed any more
        Redemptions.deleteRedemptionRequest(_redemptionRequestId);
    }

    function executeDefaultPayment(
        Agent.State storage _agent,
        Redemption.Request storage _request,
        uint64 _redemptionRequestId
    )
        internal
    {
        // pay redeemer in one or both collaterals
        (uint256 paidC1Wei, uint256 paidPoolWei) = _collateralAmountForRedemption(_agent, _request);
        Agents.payoutClass1(_agent, _request.redeemer, paidC1Wei);
        if (paidPoolWei > 0) {
            Agents.payoutFromPool(_agent, _request.redeemer, paidPoolWei, paidPoolWei);
        }
        // release remaining agent collateral
        Agents.endRedeemingAssets(_agent, _request.valueAMG, _request.poolSelfClose);
        // underlying balance is not added to free balance yet, because we don't know if there was a late payment
        // it will be (or was already) updated in call to finishRedemptionWithoutPayment (or confirmRedemptionPayment)
        emit AMEvents.RedemptionDefault(_agent.vaultAddress(), _request.redeemer, _request.underlyingValueUBA,
            paidC1Wei, paidPoolWei, _redemptionRequestId);
    }

    // payment calculation: pay redemptionDefaultFactorAgentC1BIPS (>= 1) from agent vault class 1 collateral and
    // redemptionDefaultFactorPoolBIPS from pool; however, if there is not enough in agent's vault, pay more from pool
    // assured: _agentC1Wei <= fullCollateralC1, _poolWei <= fullPoolCollateral
    function _collateralAmountForRedemption(
        Agent.State storage _agent,
        Redemption.Request storage _request
    )
        private view
        returns (uint256 _agentC1Wei, uint256 _poolWei)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        // calculate collateral data for class1
        Collateral.Data memory cdAgent = AgentCollateral.agentClass1CollateralData(_agent);
        uint256 maxAgentC1Wei = cdAgent.maxRedemptionCollateral(_agent, _request.valueAMG);
        // for pool self close redemption, everything is paid from agent's class1
        if (_request.poolSelfClose) {
            _agentC1Wei = Conversion.convertAmgToTokenWei(_request.valueAMG, cdAgent.amgToTokenWeiPrice);
            _poolWei = 0;
            // if there is not enough class1 collateral, just reduce the payment
            _agentC1Wei = Math.min(_agentC1Wei, maxAgentC1Wei);
        } else {
            _agentC1Wei = Conversion.convertAmgToTokenWei(_request.valueAMG, cdAgent.amgToTokenWeiPrice)
                .mulBips(settings.redemptionDefaultFactorAgentC1BIPS);
            // calculate paid amount and max available amount from the pool
            Collateral.Data memory cdPool = AgentCollateral.poolCollateralData(_agent);
            _poolWei = Conversion.convertAmgToTokenWei(_request.valueAMG, cdPool.amgToTokenWeiPrice)
                .mulBips(settings.redemptionDefaultFactorPoolBIPS);
            uint256 maxPoolWei = cdPool.maxRedemptionCollateral(_agent, _request.valueAMG);
            // if there is not enough collateral held by agent, pay more from the pool
            if (_agentC1Wei > maxAgentC1Wei) {
                uint256 extraPoolAmg = _request.valueAMG.mulDivRoundUp(_agentC1Wei - maxAgentC1Wei, _agentC1Wei);
                _poolWei += Conversion.convertAmgToTokenWei(extraPoolAmg, cdPool.amgToTokenWeiPrice);
                _agentC1Wei = maxAgentC1Wei;
            }
            // if there is not enough collateral in the pool, just reduce the payment - however this is not likely,
            // since redemptionDefaultFactorPoolBIPS is small or zero, while pool CR is much higher that agent CR
            _poolWei = Math.min(_poolWei, maxPoolWei);
        }
    }
}
