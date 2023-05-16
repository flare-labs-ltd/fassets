// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "flare-smart-contracts/contracts/userInterfaces/IFtsoRewardManager.sol";
import "flare-smart-contracts/contracts/userInterfaces/IClaimSetupManager.sol";
import "flare-smart-contracts/contracts/userInterfaces/IDistributionToDelegators.sol";
import "./ICollateralPoolToken.sol";


interface ICollateralPool {
    enum TokenExitType { MAXIMIZE_FEE_WITHDRAWAL, MINIMIZE_FEE_DEBT, KEEP_RATIO }

    // Also emitted in case of fee debt payment - in this case `amountNatWei = receivedTokensWei = 0`.
    event Enter(
        address indexed tokenHolder,
        uint256 amountNatWei,
        uint256 receivedTokensWei,
        uint256 addedFAssetFeesUBA);

    // In case of self-close exit, `closedFAssetsUBA` is nonzero and includes `receivedFAssetFeesUBA`.
    // Also emitted in case of fee withdrawal - in this case `burnedTokensWei = receivedNatWei = 0`.
    event Exit(
        address indexed tokenHolder,
        uint256 burnedTokensWei,
        uint256 receivedNatWei,
        uint256 receviedFAssetFeesUBA,
        uint256 closedFAssetsUBA);

    /**
     * Enters the collateral pool by depositing NAT and f-asset, obtaining pool tokens, allowing holder
     * to exit with NAT and f-asset fees later. If the user doesn't provide enough f-assets, they are
     * still able to collect future f-asset fees and exit with NAT, but their tokens are non-transferable.
     * Tokens can be made transferable by paying the f-asset fee debt and non-transferable by withdrawing
     * f-asset fees.
     * @param _fAssets                 The maximum number of f-assets that can be spent along the deposited NAT
     * @param _enterWithFullFassets    Specifies whether to enter with all "required" f-assets
     */
    function enter(uint256 _fAssets, bool _enterWithFullFassets) external payable;

    /**
     * Exits the pool by redeeming the given amount of pool tokens for a share of NAT and f-asset fees.
     * Exiting with non-transferable tokens awards user with NAT only, while transferable tokens also entitle
     * one to a share of f-asset fees. As there are multiple ways to split spending transferable and
     * non-transferable tokens, the method also takes a parameter called `_exitType`.
     * @param _tokenShare   The amount of pool tokens to be redeemed
     * @param _exitType     The ratio used to redeem transferable and non-transferable tokens
     * @notice Exiting with collateral that sinks pool's collateral ratio below exit CR is not allowed and
     *  will revert. In that case, see selfCloseExit.
     */
    function exit(uint256 _tokenShare, TokenExitType _exitType)
        external
        returns (uint256 _natShare, uint256 _fassetShare);

    /**
     * Exits the pool by redeeming the given amount of pool tokens and burning f-assets in a way that doesn't
     * endanger the pool collateral ratio. Specifically, if pool's collateral ratio is above exit CR, then
     * the method burns an amount of user's f-assets that do not lower collateral ratio below exit CR. If, on
     * the other hand, collateral pool is below exit CR, then the method burns an amount of user's f-assets
     * that preserve pool's collateral ratio.
     * @param _tokenShare                   The amount of pool tokens to be liquidated
     * @param _exitType                     the ratio used to redeem transferable and non-transferable tokens
     * @param _redeemToCollateral           Specifies if agent should redeem f-assets in NAT from his collateral
     * @param _redeemerUnderlyingAddress    Redeemer's address on the underlying chain
     * @notice F-assets will be redeemed in collateral if their value does not exceed one lot, regardless of
     *  `_redeemToCollateral` value
     * @notice Method first tries to satisfy the condition by taking f-assets out of sender's f-asset fee share,
     *  specified by `_tokenShare`. If it is not enough it moves on to spending total sender's f-asset fees. If they
     *  are not enough, it takes from the sender's f-asset balance. Spending sender's f-asset fees means that
     *  transferable tokens are converted to non-transferable, so at the end there might be less transferable tokens
     *  than effectively specified by `_exitType`.
     */
    function selfCloseExit(
        uint256 _tokenShare,
        TokenExitType _exitType,
        bool _redeemToCollateral,
        string memory _redeemerUnderlyingAddress
    ) external;

    /**
     * Collect f-asset fees by locking an appropriate ratio of transferable tokens
     * @param _amount  The amount of f-asset fees to withdraw
     */
    function withdrawFees(uint256 _amount) external;

    /**
     * Unlock pool tokens by paying f-asset fee debt
     * @param _fassets  The amount of debt f-asset fees to pay for
     */
    function payFAssetFeeDebt(uint256 _fassets) external;

    function claimAirdropDistribution(
        IDistributionToDelegators _distribution,
        uint256 _month
    ) external
        returns(uint256);

    function optOutOfAirdrop(
        IDistributionToDelegators _distribution
    ) external;

    function delegateCollateral(
        address[] memory _to,
        uint256[] memory _bips
    ) external;

    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager,
        uint256 _lastRewardEpoch
    ) external;

    function setFtsoAutoClaiming(
        IClaimSetupManager _claimSetupManager,
        address[] memory _executors
    ) external payable;

    /**
     * In case of f-asset termination, withdraw all of sender's collateral
     */
    function withdrawCollateralWhenFAssetTerminated() external;

    /**
     * Get the ERC20 pool token used by this collateral pool
     */
    function poolToken()
        external view
        returns (ICollateralPoolToken);

    /**
     * Get the vault of the agent that owns this collateral pool
     */
    function agentVault()
        external view
        returns (address);

    /**
     * Get exit collateral ratio in BIPS
     * This is the collateral ratio below which exiting the pool is not allowed
     */
    function exitCollateralRatioBIPS()
        external view
        returns (uint32);

    /**
     * Get topup collateral ratio in BIPS
     * If the pool's collateral ratio sinks below this value, users are encouraged to
     * buy collateral by making tokens have discount prices
     */
    function topupCollateralRatioBIPS()
        external view
        returns (uint32);

    /**
     * Get token discount in BIPS
     * If the pool's collateral ratio sinks below topup collateral ratio, tokens are
     * discounted by this factor
     */
    function topupTokenPriceFactorBIPS()
        external view
        returns (uint16);

    /**
     * Returns the f-asset fees belonging to this user.
     * This is the amount of f-assets the user can withdraw by burning transferable pool tokens.
     * @param _account User address
     */
    function fAssetFeesOf(address _account)
        external view
        returns (uint256);

    /**
     * Returns user's f-asset fee debt.
     * This is the amount of f-assets the user has to pay to make all pool tokens transferable.
     * The debt is created on entering the pool if the user doesn't provide the f-assets corresponding
     * to the share of the f-asset fees already in the pool.
     * @param _account User address
     */
    function fAssetFeeDebtOf(address _account)
        external view
        returns (uint256);
}
