// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "flare-smart-contracts/contracts/userInterfaces/IVPToken.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRewardManager.sol";
import "flare-smart-contracts/contracts/userInterfaces/IClaimSetupManager.sol";
import "flare-smart-contracts/contracts/userInterfaces/IDistributionToDelegators.sol";
import "./ICollateralPool.sol";

interface IAgentVault {
    // without "onlyOwner" to allow owner to send funds from any source
    function buyCollateralPoolTokens() external payable;

    // only owner
    function withdrawPoolFees(uint256 _amount, address _recipient) external;

    // only owner
    function redeemCollateralPoolTokens(uint256 _amount, address payable _recipient) external;

    // must call `token.approve(vault, amount)` before for each token in _tokens
    // without "onlyOwner" to allow owner to send funds from any source
    function depositCollateral(IERC20 _token, uint256 _amount) external;

    // update collateral after `transfer(vault, some amount)` was called (alternative to depositCollateral)
    // without "onlyOwner" to allow owner to send funds from any source
    function collateralDeposited(IERC20 _token) external;

    // only owner
    function withdrawCollateral(IERC20 _token, uint256 _amount, address _recipient) external;

    // Allow transferring a token, airdropped to the agent vault, to the owner (cold wallet).
    // Doesn't work for collateral tokens because this would allow withdrawing the locked collateral.
    // only owner
    function transferExternalToken(IERC20 _token, uint256 _amount) external;

    // only owner
    function delegate(IVPToken _token, address _to, uint256 _bips) external;

    // only owner
    function undelegateAll(IVPToken _token) external;

    // only owner
    function revokeDelegationAt(IVPToken _token, address _who, uint256 _blockNumber) external;

    // only owner
    function delegateGovernance(address _to) external;

    // only owner
    function undelegateGovernance() external;

    // Claim ftso rewards. Alternatively, you can set claim executor and then claim directly from FtsoRewardManager.
    // only owner
    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager,
        uint256 _lastRewardEpoch,
        address payable _recipient
    ) external
        returns (uint256);

    // Set executors and recipients that can then automatically claim rewards through FtsoRewardManager.
    // only owner
    function setFtsoAutoClaiming(
        IClaimSetupManager _claimSetupManager,
        address[] memory _executors,
        address[] memory _allowedRecipients
    ) external payable;

    // only owner
    function claimAirdropDistribution(
        IDistributionToDelegators _distribution,
        uint256 _month,
        address payable _recipient
    ) external
        returns(uint256);

    // only owner
    function optOutOfAirdrop(
        IDistributionToDelegators _distribution
    ) external;

    function collateralPool()
        external view
        returns (ICollateralPool);
}
