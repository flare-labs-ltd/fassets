// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IWNat.sol";

// Asset Manager methods used in AgentVault and AssetManagerController
interface IAssetManager {
    enum CollateralTokenClass {
        NONE,   // unused
        POOL,   // pool collateral type
        CLASS1  // usable as class 1 collateral
    }

    // Collateral token is uniquely identified by the pair (tokenClass, token).
    struct CollateralTokenInfo {
        // The kind of collateral for this token.
        CollateralTokenClass tokenClass;

        // The ERC20 token contract for this collateral type.
        IERC20 token;

        // Same as token.decimals(), when that exists.
        uint256 decimals;

        // Token invalidation time. Must be 0 on creation.
        uint256 validUntil;

        // When `true`, the FTSO with symbol `assetFtsoSymbol` returns asset price relative to this token
        // (such FTSO's will probably exist for major stablecoins).
        // When `false`, the FTSOs with symbols `assetFtsoSymbol` and `tokenFtsoSymbol` give asset and token
        // price relative to the same reference currency and the asset/token price is calculated as their ratio.
        bool directPricePair;

        // FTSO symbol for the asset, relative to this token or a reference currency
        // (it depends on the value of `directPricePair`).
        string assetFtsoSymbol;

        // FTSO symbol for this token in reference currency.
        // Used for asset/token price calculation when `directPricePair` is `false`.
        // Otherwise it is irrelevant to asset/token price calculation, but if it is nonempty,
        // it is still used in calculation of challenger and confirmation rewards
        // (otherwise we assume it approximates the value of USD and pay directly the USD amount in class1).
        string tokenFtsoSymbol;

        // Minimum collateral ratio for healthy agents.
        uint256 minCollateralRatioBIPS;

        // Minimum collateral ratio for agent in CCB (Collateral call band).
        // If the agent's collateral ratio is less than this, skip the CCB and go straight to liquidation.
        // A bit smaller than minCollateralRatioBIPS.
        uint256 ccbMinCollateralRatioBIPS;

        // Minimum collateral ratio required to get agent out of liquidation.
        // Will always be greater than minCollateralRatioBIPS.
        uint256 safetyMinCollateralRatioBIPS;
    }

    struct InitialAgentSettings {
        // Full address on the underlying chain (not hash).
        string underlyingAddressString;

        // The token used as class1 collateral. Must be one of the tokens obtained by `getCollateralTokens()`,
        // with class CLASS1.
        IERC20 class1CollateralToken;

        // Minting fee. Normally charged to minters for publicly available agents, but must be set
        // also for self-minting agents to pay part of it to collateral pool.
        // Fee is paid in underlying currency along with backing assets.
        uint256 feeBIPS;

        // Share of the minting fee that goes to the pool as percentage of the minting fee.
        // This share of fee is minted as f-assets and belongs to the pool.
        uint256 poolFeeShareBIPS;

        // Collateral ratio at which we calculate locked collateral and collateral available for minting.
        // Agent may set own value for minting collateral ratio on creation.
        // The value must always be greater than system minimum collateral ratio for class1 collateral.
        // Warning: having this value near global min collateral ratio can quickly lead to liquidation for public
        // agents, so it is advisable to set it significantly higher.
        uint256 mintingClass1CollateralRatioBIPS;

        // Collateral ratio at which we calculate locked collateral and collateral available for minting.
        // Agent may set own value for minting collateral ratio on creation.
        // The value must always be greater than system minimum collateral ratio for pool collateral.
        // Warning: having this value near global min collateral ratio can quickly lead to liquidation for public
        // agents, so it is advisable to set it significantly higher.
        uint256 mintingPoolCollateralRatioBIPS;

        // The factor set by the agent to multiply the price at which agent buys f-assets from pool
        // token holders on self-close exit (when requested or the redeemed amount is less than 1 lot).
        uint256 buyFAssetByAgentFactorBIPS;

        // The minimum collateral ratio above which a staker can exit the pool
        // (this is CR that must be left after exit).
        // Must be higher than system minimum collateral ratio for pool collateral.
        uint256 poolExitCollateralRatioBIPS;

        // The CR below which it is possible to enter the pool at discounted rate (to prevent liquidation).
        // Must be higher than system minimum collateral ratio for pool collateral.
        uint256 poolTopupCollateralRatioBIPS;

        // The discount to pool token price when entering and pool CR is below pool topup CR.
        uint256 poolTopupTokenPriceFactorBIPS;
    }

    function updateSettings(bytes32 _method, bytes calldata _params) external;
    function attachController(bool attached) external;
    function pause() external;
    function unpause() external;
    function terminate() external;
    function withdrawCollateral(IERC20 _token, uint256 _amountWei) external;
    function collateralDeposited(IERC20 _token) external;
    // collateral pool redemptions
    function redeemFromAgent(
        address _agentVault, address _receiver, uint256 _amountUBA, string memory _receiverUnderlyingAddress) external;
    function redeemFromAgentInCollateral(
        address _agentVault, address _receiver, uint256 _amountUBA) external;
    // collateral tokens
    function addCollateralToken(IAssetManager.CollateralTokenInfo calldata _data) external;
    function setCollateralRatiosForToken(CollateralTokenClass _tokenClass, IERC20 _token,
        uint256 _minCollateralRatioBIPS, uint256 _ccbMinCollateralRatioBIPS, uint256 _safetyMinCollateralRatioBIPS)
        external;
    function deprecateCollateralToken(CollateralTokenClass _tokenClass, IERC20 _token,
        uint256 _invalidationTimeSec) external;
    function setPoolCollateralToken(IAssetManager.CollateralTokenInfo calldata _data) external;
    // view methods
    function isCollateralToken(address _agentVault, IERC20 _token) external view returns (bool);
    function fAsset() external view returns (IERC20);
    function getWNat() external view returns (IWNat);
    function assetManagerController() external view returns (address);
    function controllerAttached() external view returns (bool);
    function assetPriceNatWei() external view returns (uint256 _multiplier, uint256 _divisor);
    function getLotSize() external view returns (uint256);
    function getCollateralPool(address _agentVault) external view returns (address);
    function getFAssetsBackedByPool(address _agentVault) external view returns (uint256);
    function getAgentVaultOwner(address _agentVault) external view
        returns (address _ownerColdAddress, address _ownerHotAddress);
    function isAgentVaultOwner(address _agentVault, address _address) external view returns (bool);
}
