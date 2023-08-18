// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "flare-smart-contracts/contracts/userInterfaces/IVPToken.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRewardManager.sol";
import "flare-smart-contracts/contracts/userInterfaces/IClaimSetupManager.sol";
import "flare-smart-contracts/contracts/userInterfaces/IDistributionToDelegators.sol";
import "./ICollateralPool.sol";

interface IAgentVault {
    /**
     * Deposit vault collateral.
     * Parameter `_token` is explicit to allow depositing before collateral switch.
     * NOTE: owner must call `token.approve(vault, amount)` before calling this method.
     * NOTE: only the owner of the agent vault may call this method. If the agent wants to deposit from
     * some other wallet, he can just do `ERC20.transfer()` and then call `updateCollateral()`.
     */
    function depositCollateral(IERC20 _token, uint256 _amount) external;

    /**
     * Update collateral after `transfer(vault, some amount)` was called (alternative to depositCollateral).
     * Parameter `_token` is explicit to allow depositing before collateral switch.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function updateCollateral(IERC20 _token) external;

    /**
     * Withdraw vault collateral. This method will work for any token, but for vault collateral and agent pool tokens
     * (which are locked because they may be backing f-assets) there is a check that there was prior announcement
     * by calling `assetManager.announceVaultCollateralWithdrawal(...)`.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function withdrawCollateral(IERC20 _token, uint256 _amount, address _recipient) external;

    /**
     * Allow transferring a token, airdropped to the agent vault, to the owner (management address).
     * Doesn't work for vault collateral tokens or agent's pool tokens  because this would allow
     * withdrawing the locked collateral.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function transferExternalToken(IERC20 _token, uint256 _amount) external;

    /**
     * Buy collateral pool tokens for NAT.
     * Holding enough pool tokens in the vault is required for minting.
     * NOTE: anybody can call this method, to allow the owner to deposit from any source.
     */
    function buyCollateralPoolTokens() external payable;

    /**
     * Collateral pool tokens which must be held by the agent accrue minting fees in form of f-assets.
     * These fees can be withdrawn using this method.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function withdrawPoolFees(uint256 _amount, address _recipient) external;

    /**
     * This method allows the agent to convert collateral pool tokens back to NAT.
     * Prior announcement is required by calling `assetManager.announceAgentPoolTokenRedemption(...)`.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function redeemCollateralPoolTokens(uint256 _amount, address payable _recipient) external;

    /**
     * Delegate FTSO vote power for a collateral token held in this vault.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function delegate(IVPToken _token, address _to, uint256 _bips) external;

    /**
     * Undelegate FTSO vote power for a collateral token held in this vault.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function undelegateAll(IVPToken _token) external;

    /**
     * Revoke FTSO vote power delegation for a block in the past for a collateral token held in this vault.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function revokeDelegationAt(IVPToken _token, address _who, uint256 _blockNumber) external;

    /**
     * Delegate governance vote power for possible NAT collateral token held in this vault.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function delegateGovernance(address _to) external;

    /**
     * Undelegate governance vote power for possible NAT collateral token held in this vault.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function undelegateGovernance() external;

    /**
     * Claim the FTSO rewards earned by delegating.
     * Alternatively, you can set a claim executor and then claim directly from FtsoRewardManager.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager,
        uint256 _lastRewardEpoch,
        address payable _recipient
    ) external
        returns (uint256);

    /**
     * Set executors and recipients that can then automatically claim rewards and airdrop.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function setAutoClaiming(
        IClaimSetupManager _claimSetupManager,
        address[] memory _executors,
        address[] memory _allowedRecipients
    ) external payable;

    /**
     * Claim airdrops earned by holding wNAT in the vault.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function claimAirdropDistribution(
        IDistributionToDelegators _distribution,
        uint256 _month,
        address payable _recipient
    ) external
        returns(uint256);

    /**
     * Opt out of airdrops for wNAT in the vault.
     * NOTE: only the owner of the agent vault may call this method.
     */
    function optOutOfAirdrop(
        IDistributionToDelegators _distribution
    ) external;

    /**
     * Get the address of the collateral pool contract corresponding to this agent vault
     * (there is 1:1 correspondence between agent vault and collateral pools).
     */
    function collateralPool()
        external view
        returns (ICollateralPool);
}
