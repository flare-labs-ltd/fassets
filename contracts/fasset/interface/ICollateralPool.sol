// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


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
}