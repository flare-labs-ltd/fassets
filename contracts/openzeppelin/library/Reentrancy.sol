// SPDX-License-Identifier: MIT

// OpenZeppelin Contracts (last updated v4.9.0) (security/ReentrancyGuard.sol)
// Modified by FlareLabs to use diamond storage

pragma solidity 0.8.23;


/**
 * Code for the `ReentrancyGuard` contract.
 */
library Reentrancy {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    struct ReentrancyGuardState {
        uint256 status;
    }

    /**
     * Should be called once at construction time of the main diamond contract.
     * Not a big issue if it is never called - just the first nonReentrant method call will use more gas.
     */
    function initializeReentrancyGuard() internal {
        ReentrancyGuardState storage state = _reentrancyGuardState();
        state.status = _NOT_ENTERED;
    }

    function nonReentrantBefore() internal {
        ReentrancyGuardState storage state = _reentrancyGuardState();
        // On the first call to nonReentrant, state.status will be _NOT_ENTERED
        require(state.status != _ENTERED, "ReentrancyGuard: reentrant call");

        // Any calls to nonReentrant after this point will fail
        state.status = _ENTERED;
    }

    function nonReentrantAfter() internal {
        ReentrancyGuardState storage state = _reentrancyGuardState();
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        state.status = _NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function reentrancyGuardEntered() internal view returns (bool) {
        ReentrancyGuardState storage state = _reentrancyGuardState();
        return state.status == _ENTERED;
    }

    /**
     * Marks a piece of code that can only be executed within a `nonReentrant` method.
     * Useful to prevent e.g. NAT transfers that don't properly guard against reentrancy
     * and to make them fail at test time.
     */
    function requireReentrancyGuard() internal view {
        require(reentrancyGuardEntered(), "ReentrancyGuard: guard required");
    }

    function _reentrancyGuardState() private pure returns (ReentrancyGuardState storage _state) {
        bytes32 position = keccak256("utils.ReentrancyGuard.ReentrancyGuardState");
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _state.slot := position
        }
    }
}
