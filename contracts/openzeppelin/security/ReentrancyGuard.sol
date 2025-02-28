// SPDX-License-Identifier: MIT

// OpenZeppelin Contracts (last updated v4.9.0) (security/ReentrancyGuard.sol)
// Modified by FlareLabs to use diamond storage

pragma solidity 0.8.23;

import "../library/Reentrancy.sol";


/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuard {
    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        Reentrancy.nonReentrantBefore();
        _;
        Reentrancy.nonReentrantAfter();
    }

    /**
     * Should be called once at construction time of the main contract (not a contructor, to allow proxies/diamond).
     * Not a big issue if it is never called - just the first nonReentrant method call will use more gas.
     */
    function initializeReentrancyGuard() internal {
        Reentrancy.initializeReentrancyGuard();
    }

    /**
     * Marks a piece of code that can only be executed within a `nonReentrant` method.
     * Useful to prevent e.g. NAT transfers that don't properly guard against reentrancy
     * and to make them fail at test time.
     */
    function requireReentrancyGuard() internal view {
        Reentrancy.requireReentrancyGuard();
    }
}
