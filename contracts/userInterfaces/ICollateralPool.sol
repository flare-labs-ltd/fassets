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

    // In case of self-close exit, `closedFAssetsUBA` is nonzero and includes `receviedFAssetFeesUBA`.
    // Also emitted in case of fee withdrawal - in this case `burnedTokensWei = receivedNatWei = 0`.
    event Exit(
        address indexed tokenHolder,
        uint256 burnedTokensWei,
        uint256 receivedNatWei,
        uint256 receviedFAssetFeesUBA,
        uint256 closedFAssetsUBA);

    function enter(uint256 _fassets, bool _enterWithFullFassets) external payable;

    function exit(uint256 _tokenShare, TokenExitType _exitType)
        external
        returns (uint256 _natShare, uint256 _fassetShare);

    function selfCloseExit(
        uint256 _tokenShare,
        TokenExitType _exitType,
        bool _redeemToCollateral,
        string memory _redeemerUnderlyingAddress
    ) external;

    function withdrawFees(uint256 _amount) external;

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

    // in case of f-asset termination
    function withdrawCollateral() external;

    /**
     * @notice Make pool tokens transferable by paying f-asset fee debt.
     * @param _fassets  Amount of payed f-assets
     *                  _fassets must be positive and smaller or equal to the sender's debt f-assets
     */
    function payFeeDebt(uint256 _fassets) external;

    function poolToken()
        external view
        returns (ICollateralPoolToken);

    function agentVault()
        external view
        returns (address);

    function exitCollateralRatioBIPS()
        external view
        returns (uint32);

    function topupCollateralRatioBIPS()
        external view
        returns (uint32);

    function topupTokenPriceFactorBIPS()
        external view
        returns (uint16);

    /**
     * @notice Returns the f-asset fees belonging to this user.
     * @param _account User address
     */
    function freeFassetOf(address _account)
        external view
        returns (uint256);

    /**
     * @notice Returns user's f-asset fee debt.
     * This is the amount of f-assets the user has to pay to make all pool tokens transferable.
     * The debt is created on entering the pool if the user doesn't provide the f-assets corresponding
     * to the share of the f-asset fees already in the pool.
     * @param _account User address
     */
    function fassetDebtOf(address _account)
        external view
        returns (uint256);
}
