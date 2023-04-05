// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICollateralPoolToken is IERC20 {
    function freeBalanceOf(address _account) external view returns (uint256);
    function debtBalanceOf(address _account) external view returns (uint256);
}
