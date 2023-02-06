// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICollateralPool {
    function payout(address _receiver, uint256 _amountWei, uint256 _agentResponsibilityWei) external;

    function poolToken() external view returns (IERC20);
}
