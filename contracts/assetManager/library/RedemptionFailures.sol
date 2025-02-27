// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "flare-smart-contracts-v2/contracts/userInterfaces/IFdcVerification.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "./Redemptions.sol";
import "./Conversion.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";


library RedemptionFailures {
    using SafePct for *;
    using Agent for Agent.State;
    using AgentCollateral for Collateral.Data;

    function redemptionPaymentDefault(
        IReferencedPaymentNonexistence.Proof calldata _nonPayment,
        uint64 _redemptionRequestId
    )
        internal
    {
        require(!_nonPayment.data.requestBody.checkSourceAddresses, "source addresses not supported");
        Redemption.Request storage request = Redemptions.getRedemptionRequest(_redemptionRequestId);
        Agent.State storage agent = Agent.get(request.agentVault);
        require(request.status == Redemption.Status.ACTIVE, "invalid redemption status");
        // verify transaction
        TransactionAttestation.verifyReferencedPaymentNonexistence(_nonPayment);
        // check non-payment proof
        require(_nonPayment.data.requestBody.standardPaymentReference ==
                PaymentReference.redemption(_redemptionRequestId) &&
            _nonPayment.data.requestBody.destinationAddressHash == request.redeemerUnderlyingAddressHash &&
            _nonPayment.data.requestBody.amount == request.underlyingValueUBA - request.underlyingFeeUBA,
            "redemption non-payment mismatch");
        require(_nonPayment.data.responseBody.firstOverflowBlockNumber > request.lastUnderlyingBlock &&
            _nonPayment.data.responseBody.firstOverflowBlockTimestamp > request.lastUnderlyingTimestamp,
            "redemption default too early");
        require(_nonPayment.data.requestBody.minimalBlockNumber <= request.firstUnderlyingBlock,
            "redemption non-payment proof window too short");
        // We allow only redeemers or agents to trigger redemption default, since they may want
        // to do it at some particular time. (Agent might want to call default to unstick redemption when
        // the redeemer is unresponsive.)
        require(msg.sender == request.redeemer || msg.sender == request.executor || Agents.isOwner(agent, msg.sender),
            "only redeemer, executor or agent");
        // pay redeemer in collateral
        executeDefaultPayment(agent, request, _redemptionRequestId);
        // pay the executor if the executor called this
        // guarded against reentrancy in RedemptionDefaultsFacet
        Redemptions.payOrBurnExecutorFee(request);
        // don't delete redemption request at end - the agent might still confirm failed payment
        request.status = Redemption.Status.DEFAULTED;
    }

     function rejectedRedemptionPaymentDefault(
        uint64 _redemptionRequestId
    )
        internal
    {
        Redemption.Request storage request = Redemptions.getRedemptionRequest(_redemptionRequestId);
        Agent.State storage agent = Agent.get(request.agentVault);
        require(request.status == Redemption.Status.ACTIVE, "invalid redemption status");
        require(request.rejectionTimestamp != 0, "only rejected redemption");
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        require(request.rejectionTimestamp + settings.takeOverRedemptionRequestWindowSeconds <= block.timestamp,
            "rejected redemption default too early");
        // We allow only redeemers or agents to trigger rejected redemption default, since they may want
        // to do it at some particular time. (Agent might want to call default to unstick redemption when
        // the redeemer is unresponsive.)
        require(msg.sender == request.redeemer || msg.sender == request.executor || Agents.isOwner(agent, msg.sender),
            "only redeemer, executor or agent");
        // pay redeemer in collateral
        executeDefaultPayment(agent, request, _redemptionRequestId);
        // pay the executor if the executor called this
        // guarded against reentrancy in RedemptionDefaultsFacet
        Redemptions.payOrBurnExecutorFee(request);
        // delete redemption request at end
        Redemptions.deleteRedemptionRequest(_redemptionRequestId);
    }

    function finishRedemptionWithoutPayment(
        IConfirmedBlockHeightExists.Proof calldata _proof,
        uint64 _redemptionRequestId
    )
        internal
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
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
            require(_proof.data.responseBody.lowestQueryWindowBlockNumber > request.lastUnderlyingBlock
                && _proof.data.responseBody.lowestQueryWindowBlockTimestamp > request.lastUnderlyingTimestamp
                && _proof.data.responseBody.lowestQueryWindowBlockTimestamp + settings.attestationWindowSeconds <=
                    _proof.data.responseBody.blockTimestamp,
                "should default first");
            executeDefaultPayment(agent, request, _redemptionRequestId);
            // burn the executor fee
            // guarded against reentrancy in RedemptionDefaultsFacet
            Redemptions.payOrBurnExecutorFee(request);
            // make sure it cannot be defaulted again
            request.status = Redemption.Status.DEFAULTED;
        }
        // we do not delete redemption request here, because we cannot be certain that proofs have expired,
        // so deleting the request could lead to successful challenge of the agent that paid, but the proof expired
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
        Agents.payoutFromVault(_agent, _request.redeemer, paidC1Wei);
        if (paidPoolWei > 0) {
            Agents.payoutFromPool(_agent, _request.redeemer, paidPoolWei, paidPoolWei);
        }
        // release remaining agent collateral
        Agents.endRedeemingAssets(_agent, _request.valueAMG, _request.poolSelfClose);
        // underlying balance is not added to free balance yet, because we don't know if there was a late payment
        // it will be (or was already) updated in call to finishRedemptionWithoutPayment (or confirmRedemptionPayment)
        emit IAssetManagerEvents.RedemptionDefault(_agent.vaultAddress(), _request.redeemer, _redemptionRequestId,
            _request.underlyingValueUBA, paidC1Wei, paidPoolWei);
            if (_request.transferToCoreVault) {
                address vaultToken = address(Agents.getVaultCollateralToken(_agent));
                emit ICoreVault.CoreVaultTransferDefault(_request.agentVault, _redemptionRequestId,
                    _request.underlyingValueUBA, vaultToken, paidC1Wei, paidPoolWei);
            }
    }

    // payment calculation: pay redemptionDefaultFactorVaultCollateralBIPS (>= 1) from agent vault collateral and
    // redemptionDefaultFactorPoolBIPS from pool; however, if there is not enough in agent's vault, pay more from pool
    // assured: _vaultCollateralWei <= fullCollateralC1, _poolWei <= fullPoolCollateral
    function _collateralAmountForRedemption(
        Agent.State storage _agent,
        Redemption.Request storage _request
    )
        private view
        returns (uint256 _vaultCollateralWei, uint256 _poolWei)
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // calculate collateral data for vault collateral
        Collateral.Data memory cdAgent = AgentCollateral.agentVaultCollateralData(_agent);
        uint256 maxVaultCollateralWei = cdAgent.maxRedemptionCollateral(_agent, _request.valueAMG);
        // for pool self close redemption, everything is paid from agent's vault collateral
        if (_request.poolSelfClose) {
            _vaultCollateralWei = Conversion.convertAmgToTokenWei(_request.valueAMG, cdAgent.amgToTokenWeiPrice);
            _poolWei = 0;
            // if there is not enough vault collateral, just reduce the payment
            _vaultCollateralWei = Math.min(_vaultCollateralWei, maxVaultCollateralWei);
        } else {
            bool isRejection = _request.rejectionTimestamp != 0;
            _vaultCollateralWei = Conversion.convertAmgToTokenWei(_request.valueAMG, cdAgent.amgToTokenWeiPrice)
                .mulBips(isRejection ? settings.rejectedRedemptionDefaultFactorVaultCollateralBIPS :
                    settings.redemptionDefaultFactorVaultCollateralBIPS);
            // calculate paid amount and max available amount from the pool
            Collateral.Data memory cdPool = AgentCollateral.poolCollateralData(_agent);
            _poolWei = Conversion.convertAmgToTokenWei(_request.valueAMG, cdPool.amgToTokenWeiPrice)
                .mulBips(isRejection ? settings.rejectedRedemptionDefaultFactorPoolBIPS :
                    settings.redemptionDefaultFactorPoolBIPS);
            uint256 maxPoolWei = cdPool.maxRedemptionCollateral(_agent, _request.valueAMG);
            // if there is not enough collateral held by agent, pay more from the pool
            if (_vaultCollateralWei > maxVaultCollateralWei) {
                uint256 extraPoolAmg =
                    _request.valueAMG.mulDivRoundUp(_vaultCollateralWei - maxVaultCollateralWei, _vaultCollateralWei);
                _poolWei += Conversion.convertAmgToTokenWei(extraPoolAmg, cdPool.amgToTokenWeiPrice);
                _vaultCollateralWei = maxVaultCollateralWei;
            }
            // if there is not enough collateral in the pool, just reduce the payment - however this is not likely,
            // since redemptionDefaultFactorPoolBIPS is small or zero, while pool CR is much higher that agent CR
            _poolWei = Math.min(_poolWei, maxPoolWei);
        }
    }
}
