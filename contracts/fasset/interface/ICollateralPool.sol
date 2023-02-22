// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/**
 * Here we declare only the functionalities related to CollateralPool.
 */
interface ICollateralPool {

    function enter(bool _depositFassets) external payable;
    function exit() external;
    function selfCloseExit(
        bool _getAgentCollateral, uint256 _tokenShare, uint256 _fassets, 
        string memory _redeemerUnderlyingAddressString) external;
    function selfCloseExitPaidWithCollateral(
        uint256 _tokenShare, uint256 _fassets) external;
    function payout(address _receiver, uint256 _amountWei, uint256 _agentResponsibilityWei) external;

    function poolToken() external view returns (IERC20);
}