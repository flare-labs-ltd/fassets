// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "flare-smart-contracts/contracts/userInterfaces/IFtsoRewardManager.sol";
import "../interface/IAssetManager.sol";


interface IAgentVault {
    function deposit() external payable;

    function delegate(address _to, uint256 _bips) external;

    function undelegateAll() external;

    function revokeDelegationAt(address _who, uint256 _blockNumber) external;

    function claimReward(
        IFtsoRewardManager ftsoRewardManager,
        address payable _recipient,
        uint256[] memory _rewardEpochs
    ) external;
    
    function withdraw(address payable _recipient, uint256 _amount) external;
    
    function withdrawAccidental(address payable _recipient) external;

    // agent should make sure to claim rewards before calling destroy(), or they will be forfeit
    function destroy(address payable _recipient) external;

    // Used by asset manager for liquidation and failed redemption.
    // Since _recipient is typically an unknown address, we do not directly send NAT,
    // but transfer WNAT (doesn't trigger any callbacks) which the recipient must withdraw.
    // Only asset manager can call this method.
    function payout(address _recipient, uint256 _amount) external;

    function owner() external view returns (address);

    function fullCollateral() external view returns (uint256);
}
