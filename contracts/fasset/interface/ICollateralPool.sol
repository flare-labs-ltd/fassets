// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IWNat.sol";


/**
 * Here we declare only the functionalities related to CollateralPool.
 */
interface ICollateralPool {

    function enter(uint256 _fassets, bool _enterWithFullFassets) external payable;
    function exit(uint256 _tokenShare) external returns (uint256 _natShare, uint256 _fassetShare);
    function withdrawFees(uint256 _amount) external;
    function selfCloseExit(
        bool _getAgentCollateral, uint256 _tokenShare, uint256 _fassets,
        string memory _redeemerUnderlyingAddressString) external;
    function selfCloseExitPaidWithCollateral(
        uint256 _tokenShare, uint256 _fassets) external;
    function payout(address _receiver, uint256 _amountWei, uint256 _agentResponsibilityWei) external;
    function destroy(address payable _recipient) external;
    function upgradeWNatContract(IWNat oldWNat, IWNat wNat) external;  // switch and transfer all balance to new wnat
    function poolToken() external view returns (IERC20);
}
