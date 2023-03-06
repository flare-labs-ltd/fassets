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

        // FTSO symbol for token.
        string ftsoSymbol;

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
}
