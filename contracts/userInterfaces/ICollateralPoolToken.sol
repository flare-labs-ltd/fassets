// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICollateralPoolToken is IERC20 {

    /**
     * Returns the address of the collateral pool that issued this token.
     */
    function collateralPool()
        external view
        returns (address);

    /**
     * Returns the amount of tokens that is locked for transferring.
     */
    function lockedBalanceOf(address _account)
        external view
        returns (uint256);

    /**
     * Returns the amount of tokens that can be transferred.
     */
    function transferableBalanceOf(address _account)
        external view
        returns (uint256);

    /**
     * Returns the amount of account's tokens that are considered debt.
     */
    function debtLockedBalanceOf(address _account)
        external view
        returns (uint256);

    /**
     * Returns the amount of account's tokens that are not considered debt.
     */
    function debtFreeBalanceOf(address _account)
        external view
        returns (uint256);

    /**
     * Returns the amount of account's tokens that are timelocked.
     */
    function timelockedBalanceOf(address _account)
        external view
        returns (uint256);

    /**
     * Returns the amount of account's tokens that are timelocked.
     */
    function nonTimelockedBalanceOf(address _account)
        external view
        returns (uint256);
}
