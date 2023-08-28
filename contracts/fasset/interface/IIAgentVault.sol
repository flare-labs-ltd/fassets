// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "../../userInterfaces/IAgentVault.sol";
import "./IWNat.sol";


interface IIAgentVault is IAgentVault {
    // Used by asset manager when destroying agent.
    // Completely erases agent vault and transfers all funds to the owner.
    // onlyAssetManager
    function destroy(address payable _recipient) external;

    // Used by asset manager for liquidation and failed redemption.
    // Is nonReentrant to prevent reentrancy in case the token has receive hooks.
    // onlyAssetManager
    function payout(IERC20 _token, address _recipient, uint256 _amount) external;

    // Only supposed to be used from asset manager, but safe to be used by anybody.
    // Typically used to transfer overpaid amounts to the vault.
    function depositNat(IWNat _wNat) external payable;

    // Used by asset manager (only for burn for now).
    // Is nonReentrant to prevent reentrancy, in case this is not the last method called.
    // onlyAssetManager
    function payoutNAT(IWNat _wNat, address payable _recipient, uint256 _amount) external;

    // Enables owner checks in the asset manager.
    function isOwner(address _address) external view returns (bool);
}
