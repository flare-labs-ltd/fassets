// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "./PaymentVerification.sol";
import "./AssetManagerState.sol";


library IllegalPaymentChallenge {
    using SafeMath for uint256;
    using PaymentVerification for PaymentVerification.State;
    
    struct Challenge {
        address agentVault;
        uint64 createdAtBlock;
        bytes32 underlyingSourceAddress;
        bytes32 transactionHash;
        address challenger;
        uint64 createdAt;
    }
    
    event IllegalPaymentChallenged(
        address indexed agentVault,
        bytes32 underlyingAddress, 
        bytes32 transactionHash);
    
    event IllegalPaymentConfirmed(
        address indexed agentVault,
        bytes32 underlyingAddress, 
        bytes32 transactionHash);
        
    function createChallenge(
        AssetManagerState.State storage _state,
        address _agentVault,
        bytes32 _underlyingSourceAddress,
        bytes32 _transactionHash,
        address _challenger
    )
        internal
    {
        require(!challengeExists(_state, _transactionHash), "challenge already exists");
        require(!_state.paymentVerifications.paymentVerified(_transactionHash), "payment already verified");
        _state.paymentChallenges[_transactionHash] = Challenge({
            agentVault: _agentVault,
            underlyingSourceAddress: _underlyingSourceAddress,
            transactionHash: _transactionHash,
            challenger: _challenger,
            createdAtBlock: SafeCast.toUint64(block.number),
            createdAt: SafeCast.toUint64(block.timestamp)
        });
        emit IllegalPaymentChallenged(_agentVault, _underlyingSourceAddress, _transactionHash);
    }
    
    function confirmChallenge(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo,
        address _challenger
    )
        internal
    {
        Challenge storage challenge = _state.paymentChallenges[paymentInfo.transactionHash];
        require(challenge.agentVault != address(0), "invalid transaction hash");
        require(challenge.challenger == _challenger, "only challenger");
        require(uint256(challenge.createdAt).add(_state.settings.paymentChallengeWaitMinSeconds) <= block.timestamp,
            "confirmation too early");
        require(challenge.underlyingSourceAddress == paymentInfo.sourceAddress, "source address doesn't match");
        _state.paymentVerifications.verifyPayment(paymentInfo);
        deleteChallenge(_state, paymentInfo.transactionHash);
        // TODO: trigger liquidation, claim reward
        emit IllegalPaymentConfirmed(challenge.agentVault, challenge.underlyingSourceAddress, 
            paymentInfo.transactionHash);
    }
    
    function deleteChallenge(
        AssetManagerState.State storage _state, 
        bytes32 _transactionHash
    ) 
        internal 
    {
        if (challengeExists(_state, _transactionHash)) {
            delete _state.paymentChallenges[_transactionHash];
        }
    }
    
    function challengeExists(
        AssetManagerState.State storage _state, 
        bytes32 _transactionHash
    ) 
        internal view 
        returns (bool) 
    {
        return _state.paymentChallenges[_transactionHash].agentVault != address(0);
    }
}
