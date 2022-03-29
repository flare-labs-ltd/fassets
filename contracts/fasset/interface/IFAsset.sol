// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Here we declare only the functionalities related to AssetManager.
 */
interface IFAsset {
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
     * Stops all transfers by setting `stopped` flag to true.
     * Only the assetManager corresponding to this fAsset may call `stop()`.
     */    
    function stop() external;
    
    /**
     * Get the asset manager, corresponding to this fAsset.
     * fAssets and asset managers are in 1:1 correspondence.
     */
    function assetManager() external view returns (address);

    /**
     * When f-asset is stopped, no transfers can be made anymore.
     * This is an extreme measure to be used only when the asset manager minting has been already paused
     * for a long time but there still exist unredeemable f-assets. In such case, the f-asset contract is
     * stopped and then agents can buy back the collateral at market rate (i.e. they burn market value
     * of backed f-assets in collateral to release the rest of the collateral).
     */
    function stopped() external view returns (bool);
}
