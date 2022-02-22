// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafeBips.sol";
import "../interface/IAgentVault.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./Liquidation.sol";
import "./PaymentReference.sol";
import "./PaymentVerification.sol";
import "./Redemption.sol";
import "./AssetManagerState.sol";
import "./AgentCollateral.sol";


library Challenges {
    using AgentCollateral for AgentCollateral.Data;
    using PaymentVerification for PaymentVerification.State;

    function illegalPaymentChallenge(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        // check the payment originates from agent's address
        require(_paymentInfo.sourceAddressHash == agent.underlyingAddressHash, "chlg: not agent's address");
        // check that proof of this tx wasn't used before (and mark it as used) - otherwise we could 
        // trigger liquidation for already proved redemption payments
        _state.paymentVerifications.confirmSourceDecreasingTransaction(_paymentInfo);
        // check that payment reference is invalid (paymentReference == 0 is always invalid payment)
        if (_paymentInfo.paymentReference != 0) {
            if (PaymentReference.isValid(_paymentInfo.paymentReference, PaymentReference.REDEMPTION)) {
                uint64 redemptionId = PaymentReference.decodeId(_paymentInfo.paymentReference);
                Redemption.RedemptionRequest storage request = _state.redemptionRequests[redemptionId];
                require(request.agentVault == address(0), "matching redemption active");
            }
            if (PaymentReference.isValid(_paymentInfo.paymentReference, PaymentReference.ANNOUNCED_WITHDRAWAL)) {
                uint256 announcementId = PaymentReference.decodeId(_paymentInfo.paymentReference);
                // valid announced payment cannot have announcementId == 0 and must match the agent's announced id
                require(announcementId == 0 || announcementId != agent.ongoingAnnouncedPaymentId, 
                    "matching ongoing announced pmt");
            }
        }
        // start liquidation and reward challengers
        _liquidateAndRewardChallenger(_state, _agentVault, msg.sender, agent.mintedAMG);
        // emit events
        emit AMEvents.IllegalPaymentConfirmed(_agentVault, _paymentInfo.transactionHash);
    }
    
    function doublePaymentChallenge(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo1,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo2,
        address _agentVault
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        // check the payments originate from agent's address
        require(_paymentInfo1.sourceAddressHash == agent.underlyingAddressHash, "chlg 1: not agent's address");
        require(_paymentInfo2.sourceAddressHash == agent.underlyingAddressHash, "chlg 2: not agent's address");
        // payment references must be equal
        require(_paymentInfo1.paymentReference == _paymentInfo2.paymentReference, "challenge: not duplicate");
        // ! no need to check that transaction wasn't confirmed - this is always illegal
        // start liquidation and reward challengers
        _liquidateAndRewardChallenger(_state, _agentVault, msg.sender, agent.mintedAMG);
        // emit events
        emit AMEvents.DuplicatePaymentConfirmed(_agentVault,
            _paymentInfo1.transactionHash, _paymentInfo2.transactionHash);
    }
    
    function paymentsMakeFreeBalanceNegative(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo[] memory _paymentInfos,
        address _agentVault
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        // check the payments originates from agent's address, are not confirmed already and calculate total
        int256 total = 0;
        for (uint256 i = 0; i < _paymentInfos.length; i++) {
            PaymentVerification.UnderlyingPaymentInfo memory pmi = _paymentInfos[i];
            require(pmi.sourceAddressHash == agent.underlyingAddressHash,
                "mult chlg: not agent's address");
            require(!_state.paymentVerifications.transactionConfirmed(pmi),
                "mult chlg: payment confirmed");
            if (PaymentReference.isValid(pmi.paymentReference, PaymentReference.REDEMPTION)) {
                // for redemption, we don't count the value that should be paid to free balance deduction
                uint64 redemptionId = PaymentReference.decodeId(pmi.paymentReference);
                Redemption.RedemptionRequest storage request = _state.redemptionRequests[redemptionId];
                total += pmi.spentUBA - SafeCast.toInt256(request.underlyingValueUBA);
            } else {
                // for other payment types (annouced withdrawal), everything is paid from free balance
                total += pmi.spentUBA;
            }
        }
        // check that total spent free balance is more than actual free underlying balance
        require(total > agent.freeUnderlyingBalanceUBA, "mult chlg: enough free balance");
        // start liquidation and reward challengers
        _liquidateAndRewardChallenger(_state, _agentVault, msg.sender, agent.mintedAMG);
        // emit events
        emit AMEvents.UnderlyingFreeBalanceNegative(_agentVault, total - agent.freeUnderlyingBalanceUBA);
    }

    function _liquidateAndRewardChallenger(
        AssetManagerState.State storage _state,
        address _agentVault,
        address _challenger, 
        uint64 _backingAMGAtChallenge
    ) 
        private
    {
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, _agentVault);
        // start full liquidation
        Liquidation.startLiquidation(_state, _agentVault, collateralData, true);
        // calculate the reward
        uint256 rewardAMG = SafeBips.mulBips(_backingAMGAtChallenge, _state.settings.paymentChallengeRewardBIPS)
            + _state.settings.paymentChallengeRewardAMG;
        uint256 rewardNATWei = Conversion.convertAmgToNATWei(rewardAMG, collateralData.amgToNATWeiPrice);
        IAgentVault(_agentVault).liquidate(_challenger, rewardNATWei);
    }
}
