// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafeBips.sol";
import "../interface/IAgentVault.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./Liquidation.sol";
import "./PaymentVerification.sol";
import "./PaymentReports.sol";
import "./AssetManagerState.sol";
import "./AgentCollateral.sol";


library IllegalPaymentChallenge {
    using AgentCollateral for AgentCollateral.Data;
    using PaymentVerification for PaymentVerification.State;
    
    struct Challenge {
        // underlying source address and transaction hash are not recorded in this structure, 
        // since they are encoded in the mapping key
        
        // the agent identification
        address agentVault;

        // block when challenge was created (to prevent front running by announcement)        
        uint64 createdAtBlock;
        
        // the challenger address (for rewarding successful challenge)
        address challenger;
        
        // timestamp when created (to allow agent time to respond and for cleanup)
        uint64 createdAt;
        
        // amount of assets the address was backing at the time of challenge
        // this is (optionally) used for challenger rewards and agent punishment
        uint64 mintedAMG;
    }
    
    struct Challenges {
        // type: mapping(PaymentVerification.transactionKey(sourceAddressHash, transactionHash) => Challenge)
        // illegal transaction on smart contract chain can affect several addresses,
        // therefore the key is combined transaction hash and affected underlying source address
        mapping(bytes32 => Challenge) challenges;
    }
    
    function createChallenge(
        AssetManagerState.State storage _state,
        address _agentVault,
        bytes32 _transactionHash
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        bytes32 txKey = PaymentVerification.transactionKey(agent.underlyingAddressHash, _transactionHash);
        // only one challenge per (source addres, transaction hash) pair
        require(!_challengeExists(_state, txKey), "challenge already exists");
        // cannot challenge confirmed transactions
        require(!_state.paymentVerifications.transactionConfirmed(txKey), "payment already confirmed");
        // and that it actually backs any minting
        require(agent.mintedAMG > 0, "address empty");
        // if a challenge was alerady proved, we do not accept new challenges
        require(agent.successfulPaymentChallenges == 0, "a challenge already proved");
        _state.paymentChallenges.challenges[txKey] = Challenge({
            agentVault: _agentVault,
            challenger: msg.sender,
            createdAtBlock: SafeCast.toUint64(block.number),
            createdAt: SafeCast.toUint64(block.timestamp),
            mintedAMG: agent.mintedAMG
        });
        emit AMEvents.IllegalPaymentChallenged(_agentVault, _transactionHash);
    }
    
    function confirmChallenge(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo
    )
        external
    {
        Challenge storage challenge = 
            getChallenge(_state, _paymentInfo.sourceAddressHash, _paymentInfo.transactionHash);
        address agentVault = challenge.agentVault;
        require(agentVault != address(0), "challenge does not exist");
        // there is a minimum time required before challenge and challenge confirmation
        // TODO: is this still needed - one reason was to allow agent time for report, but now report is mandatory
        uint256 earliestTime = uint256(challenge.createdAt) + _state.settings.paymentChallengeWaitMinSeconds;
        require(earliestTime <= block.timestamp, "confirmation too early");
        // cannot challenge if there is a matching report
        PaymentReports.ReportMatch reportMatch = PaymentReports.reportMatch(_state.paymentReports, _paymentInfo);
        require(reportMatch != PaymentReports.ReportMatch.MATCH, "matching report exists");
        // check that proof of this tx wasn't used before and mark it as used
        _state.paymentVerifications.confirmSourceDecreasingTransaction(_paymentInfo);
        // start liquidation and reward challengers
        _liquidateAndRewardChallengers(_state, agentVault, challenge.challenger, msg.sender, challenge.mintedAMG);
        // emit events
        emit AMEvents.IllegalPaymentConfirmed(agentVault, _paymentInfo.transactionHash);
        // cleanup
        deleteChallenge(_state, _paymentInfo);
        if (reportMatch != PaymentReports.ReportMatch.DOES_NOT_EXIST) {
            PaymentReports.deleteReport(_state.paymentReports, _paymentInfo);
        }
    }
    
    function confirmWrongReportChallenge(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault
    )
        external
    {
        require(PaymentReports.reportMatch(_state.paymentReports, _paymentInfo) == PaymentReports.ReportMatch.MISMATCH,
            "no report mismatch");
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        // check that proof of this tx wasn't used before and mark it as used
        _state.paymentVerifications.confirmSourceDecreasingTransaction(_paymentInfo);
        // challenge (if it exists) is needed to reward original challenger and get amount of minting at the time
        Challenge storage challenge = 
            getChallenge(_state, _paymentInfo.sourceAddressHash, _paymentInfo.transactionHash);
        bool challengeExists = challenge.challenger != address(0);
        // wrong report challenge is accepted only if an unproved challenge exists for this tx hash 
        // or if this is the first successful challenge
        require(challengeExists || agent.successfulPaymentChallenges == 0, "a challenge already proved");
        // if the challenge exists, use its mintedAMG value (cannot be 0), otherwise use current value for the address
        uint64 backingAMG = challenge.mintedAMG != 0 ? challenge.mintedAMG : agent.mintedAMG;
        _liquidateAndRewardChallengers(_state, _agentVault, challenge.challenger, msg.sender, backingAMG);
        // emit events
        emit AMEvents.WrongPaymentReportConfirmed(_agentVault, _paymentInfo.transactionHash);
        // cleanup
        if (challengeExists) {
            deleteChallenge(_state, _paymentInfo);
        }
        PaymentReports.deleteReport(_state.paymentReports, _paymentInfo);
    }

    function deleteChallenge(
        AssetManagerState.State storage _state, 
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo
    ) 
        internal 
    {
        bytes32 txKey = PaymentVerification.transactionKey(_paymentInfo);
        if (_challengeExists(_state, txKey)) {
            delete _state.paymentChallenges.challenges[txKey];
        }
    }
    
    function getChallenge(
        AssetManagerState.State storage _state,
        bytes32 _sourceAddressHash,
        bytes32 _transactionHash
    )
        internal view
        returns (Challenge storage)
    {
        bytes32 txKey = PaymentVerification.transactionKey(_sourceAddressHash, _transactionHash);
        return _state.paymentChallenges.challenges[txKey];
    }
    
    function _liquidateAndRewardChallengers(
        AssetManagerState.State storage _state,
        address _agentVault,
        address _challenger, 
        address _challengeProver,
        uint64 _backingAMGAtChallenge
    ) 
        private
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, _agentVault);
        // start full liquidation
        Liquidation.startLiquidation(_state, _agentVault, collateralData, true);
        // calculate the reward
        uint256 rewardAMG = SafeBips.mulBips(_backingAMGAtChallenge, _state.settings.paymentChallengeRewardBIPS)
            + _state.settings.paymentChallengeRewardAMG;
        uint256 rewardNATWei = Conversion.convertAmgToNATWei(rewardAMG, collateralData.amgToNATWeiPrice);
        // divide reward by `2 ** agent.successfulPaymentChallenges` so that in case of multiple successful 
        // challenges each next challenge gets only half the reward of the previous, summing to at most twice the
        // original reward sum
        rewardNATWei /= 2 ** agent.successfulPaymentChallenges;
        // if challenger is different from challenge prover, the reward is split between them
        if (_challenger != address(0) && _challenger != _challengeProver) {
            rewardNATWei /= 2;
            IAgentVault(_agentVault).liquidate(_challenger, rewardNATWei);
        }
        IAgentVault(_agentVault).liquidate(_challengeProver, rewardNATWei);
        // update successful challenge count
        agent.successfulPaymentChallenges += 1;
    }
    
    function _challengeExists(
        AssetManagerState.State storage _state, 
        bytes32 _sourceTxHash
    ) 
        private view 
        returns (bool) 
    {
        return _state.paymentChallenges.challenges[_sourceTxHash].agentVault != address(0);
    }
}
