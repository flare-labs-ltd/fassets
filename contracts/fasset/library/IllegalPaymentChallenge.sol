// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";
import "../../utils/lib/SafeMath64.sol";
import "./PaymentVerification.sol";


library IllegalPaymentChallenge {
    using SafeMath for uint256;
    using SafePct for uint256;
    using PaymentVerification for PaymentVerification.State;
    
    struct Challenge {
        address agentVault;
        bytes32 underlyingSource;
        address challenger;
        uint64 createdAtBlock;
    }
    
    struct State {
        // settings
        uint64 challengeWaitBlocks;
        // data
        mapping(bytes32 => Challenge) challenges;   // mapping transactionHash=>challenge
    }
    
    function createChallenge(
        State storage _state,
        bytes32 _transactionHash,
        address _agentVault,
        bytes32 _underlyingSource,
        address _challenger
    )
        internal
    {
        require(!challengeExists(_state, _transactionHash), "challenge already exists");
        _state.challenges[_transactionHash] = Challenge({
            agentVault: _agentVault,
            underlyingSource: _underlyingSource,
            challenger: _challenger,
            createdAtBlock: SafeMath64.toUint64(block.number)
        });
    }
    
    function confirmChallenge(
        State storage _state,
        PaymentVerification.State storage _verification,
        PaymentVerification.UnderlyingPaymentInfo memory paymentInfo,
        address _challenger
    )
        internal
    {
        Challenge storage challenge = _state.challenges[paymentInfo.paymentHash];
        require(challenge.agentVault != address(0), "invalid transaction hash");
        require(challenge.challenger == _challenger, "only challenger");
        require(SafeMath64.add64(challenge.createdAtBlock, _state.challengeWaitBlocks) <= block.number,
            "confirmation too early");
        require(challenge.underlyingSource == paymentInfo.sourceAddress, "source address doesn't match");
        require(!_verification.paymentVerified(paymentInfo.paymentHash), "payment already verified");
        _verification.markPaymentVerified(paymentInfo.paymentHash);
    }
    
    function deleteChallenge(State storage _state, bytes32 _transactionHash) internal {
        if (challengeExists(_state, _transactionHash)) {
            delete _state.challenges[_transactionHash];
        }
    }
    
    function challengeExists(State storage _state, bytes32 _transactionHash) internal view returns (bool) {
        return _state.challenges[_transactionHash].agentVault != address(0);
    }
}
