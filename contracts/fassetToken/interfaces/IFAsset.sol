// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./ICheckPointable.sol";


interface IFAsset is IERC20, IERC20Metadata, ICheckPointable {
    /**
     * Mints `_amount` od fAsset.
     * Only the assetManager corresponding to this fAsset may call `mint()`.
     */
    function mint(address _owner, uint256 _amount) external;

    /**
     * Burns `_amount` od fAsset.
     * Only the assetManager corresponding to this fAsset may call `burn()`.
     */
    function burn(address _owner, uint256 _amount) external;


    /**
     * Stops all transfers by setting `terminated` flag to true.
     * Only the assetManager corresponding to this fAsset may call `terminate()`.
     */
    function terminate() external;

    /**
     * The name of the underlying asset.
     */
    function assetName() external view returns (string memory);

    /**
     * The symbol of the underlying asset.
     */
    function assetSymbol() external view returns (string memory);

    /**
     * Get the asset manager, corresponding to this fAsset.
     * fAssets and asset managers are in 1:1 correspondence.
     */
    function assetManager() external view returns (address);

    /**
     * True if f-asset is terminated. Stopped f-asset can never be re-enabled.
     *
     * When f-asset is terminated, no transfers can be made anymore.
     * This is an extreme measure to be used as an optional last phase of asset manager upgrade,
     * when the asset manager minting has already been paused for a long time but there still exist
     * unredeemable f-assets, which at this point are considered unrecoverable (lost wallet keys etc.).
     * In such case, the f-asset contract is terminated and then agents can buy back their collateral at market rate
     * (i.e. they burn market value of backed f-assets in collateral to release the rest of the collateral).
     */
    function terminated() external view returns (bool);
}
