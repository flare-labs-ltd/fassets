// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "../../userInterfaces/IAgentVault.sol";
import "./IWNat.sol";


interface IIAgentVault is IAgentVault {
    function depositNat() external payable;

    // Used by asset manager when destroying agent.
    // Completely erases agent vault and transfers all funds to the owner.
    // onlyAssetManager
    function destroy(address payable _recipient) external;

    // Used by asset manager for liquidation and failed redemption.
    // Is nonReentrant to prevent reentrancy in case the token has receive hooks.
    // onlyAssetManager
    function payout(IERC20 _token, address _recipient, uint256 _amount) external;

    // Used by asset manager (only for burn for now).
    // Is nonReentrant to prevent reentrancy, in case this is not the last method called.
    // onlyAssetManager
    function payoutNAT(address payable _recipient, uint256 _amount) external;

    function isOwner(address _address) external view returns (bool);

    function wNat() external view returns (IWNat);
}
