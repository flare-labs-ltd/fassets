// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "flare-smart-contracts/contracts/userInterfaces/IFtsoRewardManager.sol";
import "flare-smart-contracts/contracts/userInterfaces/IClaimSetupManager.sol";
import "flare-smart-contracts/contracts/userInterfaces/IDistributionToDelegators.sol";
import "./IWNat.sol";


interface IAgentVault {
    enum TokenType {
        ERC20,
        VP_TOKEN,
        WNAT
    }
    
    function depositNat() external payable;

    function depositCollateral(IERC20[] memory _tokens, uint256[] memory _amounts) external;
    
    function updateCollateral(IERC20[] memory _tokens) external;
    
    function delegate(IVPToken _token, address _to, uint256 _bips) external;

    function undelegateAll(IVPToken _token) external;

    function revokeDelegationAt(IVPToken _token, address _who, uint256 _blockNumber) external;

    function delegateGovernance(address _to) external;

    function undelegateGovernance() external;

    function claimFtsoRewards(IFtsoRewardManager _ftsoRewardManager, uint256 _lastRewardEpoch) external 
        returns (uint256);
        
    function setFtsoAutoClaiming(
        IClaimSetupManager _claimSetupManager, 
        address[] memory _executors,
        address[] memory _allowedRecipients
    ) external payable;

    function optOutOfAirdrop(IDistributionToDelegators _distribution) external;

    function claimAirdropDistribution(
        IDistributionToDelegators _distribution,
        uint256 _month
    ) external returns(uint256);
    
    function withdrawNat(uint256 _amount, address payable _recipient) external;
    
    function withdrawCollateral(IERC20[] memory _tokens, uint256[] memory _amounts, address _recipient) external;

    // agent should make sure to claim rewards before calling destroy(), or they will be forfeit
    function destroy(IERC20[] memory _tokens, TokenType[] memory _tokenTypes) external;

    // Used by asset manager for liquidation and failed redemption.
    // Since _recipient is typically an unknown address, we do not directly send NAT,
    // but transfer WNAT (doesn't trigger any callbacks) which the recipient must withdraw.
    // Only asset manager can call this method.
    function payout(IERC20[] memory _tokens, address _recipient, uint256[] memory _amounts) external;

    // Used by asset manager (only for burn for now).
    // Is guarded against reentrancy.
    // Only asset manager can call this method.
    function payoutNAT(IWNat wNat, address payable _recipient, uint256 _amount) external;

    function transferExternalToken(IERC20 _token, uint256 _amount) external;

    function owner() external view returns (address payable);
}
