// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/lib/SafeMath64.sol";
import "./PaymentVerification.sol";
import "./AssetManagerState.sol";


library IllegalPaymentChallenge {
    using SafeMath for uint256;
    using PaymentVerification for PaymentVerification.State;
    
    struct Challenge {
        address agentVault;
        bytes32 underlyingSourceAddress;
        address challenger;
        uint64 createdAtBlock;
    }
    
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
            challenger: _challenger,
            createdAtBlock: SafeMath64.toUint64(block.number)
        });
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
        require(uint256(challenge.createdAtBlock).add(_state.settings.paymentChallengeWaitMinSeconds) <= block.number,
            "confirmation too early");
        require(challenge.underlyingSourceAddress == paymentInfo.sourceAddress, "source address doesn't match");
        _state.paymentVerifications.verifyPayment(paymentInfo);
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
