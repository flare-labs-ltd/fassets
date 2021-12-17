// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "./Agents.sol";
import "./PaymentVerification.sol";
import "./UnderlyingAddressOwnership.sol";
import "./PaymentReport.sol";
import "./AssetManagerState.sol";


library IllegalPaymentChallenge {
    using SafeMath for uint256;
    using PaymentVerification for PaymentVerification.State;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    
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
        // type: mapping(PaymentVerification.transactionKey(underlyingSourceAddress, transactionHash) => Challenge)
        // illegal transaction on smart contract chain can affect several addresses,
        // therefore the key is combined transaction hash and affected underlying source address
        mapping(bytes32 => Challenge) challenges;
    }
    
    event IllegalPaymentChallenged(
        address indexed agentVault,
        bytes32 underlyingAddress, 
        bytes32 transactionHash);
    
    event IllegalPaymentConfirmed(
        address indexed agentVault,
        bytes32 underlyingAddress, 
        bytes32 transactionHash);
        
    event WrongPaymentReportConfirmed(
        address indexed agentVault,
        bytes32 underlyingAddress, 
        bytes32 transactionHash);
        
    function createChallenge(
        AssetManagerState.State storage _state,
        address _agentVault,
        bytes32 _underlyingSourceAddress,
        bytes32 _transactionHash
    )
        internal
    {
        bytes32 txKey = PaymentVerification.transactionKey(_underlyingSourceAddress, _transactionHash);
        // only one challenge per (source addres, transaction hash) pair
        require(!_challengeExists(_state, txKey), "challenge already exists");
        // cannot challenge confirmed transactions
        require(!_state.paymentVerifications.paymentConfirmed(txKey), "payment already confirmed");
        // check that the address belongs to the agent
        Agents.UnderlyingFunds storage uaf = _checkAgentsAddress(_state, _agentVault, _underlyingSourceAddress);
        // and that it actually backs any minting
        require(uaf.mintedAMG > 0, "address empty");
        _state.paymentChallenges.challenges[txKey] = Challenge({
            agentVault: _agentVault,
            challenger: msg.sender,
            createdAtBlock: SafeCast.toUint64(block.number),
            createdAt: SafeCast.toUint64(block.timestamp),
            mintedAMG: uaf.mintedAMG
        });
        emit IllegalPaymentChallenged(_agentVault, _underlyingSourceAddress, _transactionHash);
    }
    
    function confirmChallenge(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo
    )
        internal
    {
        Challenge storage challenge = getChallenge(_state, _paymentInfo.sourceAddress, _paymentInfo.transactionHash);
        require(challenge.agentVault != address(0), 
            "challenge does not exist");
        // there is a minimum time required before challenge and challenge confirmation
        // TODO: is this still needed - one reason was to allow agent time for report, but now report is mandatory
        require(uint256(challenge.createdAt).add(_state.settings.paymentChallengeWaitMinSeconds) <= block.timestamp,
            "confirmation too early");
        // cannot challenge if there is a matching report
        require(PaymentReport.reportMatch(_state.paymentReports, _paymentInfo) != PaymentReport.ReportMatch.MATCH,
            "matching report exists");
        // check that proof of this tx wasn't used before and mark it as used
        _state.paymentVerifications.confirmPayment(_paymentInfo);
        _startLiquidation(_state, challenge.agentVault, _paymentInfo.sourceAddress);
        _rewardChallengers(_state, challenge.challenger, msg.sender, challenge.mintedAMG);
        emit IllegalPaymentConfirmed(challenge.agentVault, _paymentInfo.sourceAddress, _paymentInfo.transactionHash);
        deleteChallenge(_state, _paymentInfo);
    }
    
    function confirmWrongReportChallenge(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault
    )
        internal
    {
        require(PaymentReport.reportMatch(_state.paymentReports, _paymentInfo) == PaymentReport.ReportMatch.MISMATCH,
            "no report mismatch");
        // check that the address belongs to the agent
        Agents.UnderlyingFunds storage uaf = _checkAgentsAddress(_state, _agentVault, _paymentInfo.sourceAddress);
        // check that proof of this tx wasn't used before and mark it as used
        _state.paymentVerifications.confirmPayment(_paymentInfo);
        // challenge (if it exists) is needed to reward original challenger and get amount of minting at the time
        Challenge storage challenge = getChallenge(_state, _paymentInfo.sourceAddress, _paymentInfo.transactionHash);
        // if the challenge exists, use its mintedAMG value (cannot be 0), otherwise use current for the address
        uint64 backingAMG = challenge.mintedAMG != 0 ? challenge.mintedAMG : uaf.mintedAMG;
        _startLiquidation(_state, _agentVault, _paymentInfo.sourceAddress);
        _rewardChallengers(_state, challenge.challenger, msg.sender, backingAMG);
        emit WrongPaymentReportConfirmed(_agentVault, _paymentInfo.sourceAddress, _paymentInfo.transactionHash);
        deleteChallenge(_state, _paymentInfo);
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
        bytes32 _sourceAddress,
        bytes32 _transactionHash
    )
        internal view
        returns (Challenge storage)
    {
        bytes32 txKey = PaymentVerification.transactionKey(_sourceAddress, _transactionHash);
        return _state.paymentChallenges.challenges[txKey];
    }
    
    function _startLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault,
        bytes32 _underlyingAddress
    ) 
        private
    {
        // TODO
    }
    
    function _rewardChallengers(
        AssetManagerState.State storage _state,
        address _challenger, 
        address _challengeProver,
        uint64 _backingAMGAtChallenge
    ) 
        private
    {
        // TODO
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
    
    function _checkAgentsAddress(
        AssetManagerState.State storage _state,
        address _agentVault,
        bytes32 _underlyingAddress
    )
        private view
        returns (Agents.UnderlyingFunds storage)
    {
        require(_state.underlyingAddressOwnership.check(_agentVault, _underlyingAddress), 
            "address not owned by the agent");
        Agents.UnderlyingFunds storage uaf = Agents.getUnderlyingFunds(_state, _agentVault, _underlyingAddress);
        require(uaf.mintedAMG > 0, "address empty");
        return uaf;
    }
}
