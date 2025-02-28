// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "../security/ReentrancyGuard.sol";
import "./ReentrancyAttackMock.sol";

contract ReentrancyMock is ReentrancyGuard {
    uint256 public counter;

    constructor(bool _initialize) {
        if (_initialize) {
            initializeReentrancyGuard();
        }
        counter = 0;
    }

    function callback() external nonReentrant {
        requireReentrancyGuard();
        _count();
    }

    function countLocalRecursive(uint256 n) public nonReentrant {
        requireReentrancyGuard();
        if (n > 0) {
            _count();
            countLocalRecursive(n - 1);
        }
    }

    function countThisRecursive(uint256 n) public nonReentrant {
        requireReentrancyGuard();
        if (n > 0) {
            _count();
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = address(this).call(abi.encodeWithSignature("countThisRecursive(uint256)", n - 1));
            require(success, "ReentrancyMock: failed call");
        }
    }

    function unguardedMethodThatShouldFail() public {
        requireReentrancyGuard();
        _count();
    }

    function countAndCall(ReentrancyAttackMock attacker) public nonReentrant {
        _count();
        bytes4 func = bytes4(keccak256("callback()"));
        attacker.callSender(func);
    }

    function _count() private {
        counter += 1;
    }

    function guardedCheckEntered() public nonReentrant {
        require(Reentrancy.reentrancyGuardEntered());
    }

    function unguardedCheckNotEntered() public view {
        require(!Reentrancy.reentrancyGuardEntered());
    }
}
