// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import { VPToken } from "../../../cache/flattened/FlareSmartContracts.sol";
import "../interface/IFAsset.sol";

contract FAsset is IFAsset, VPToken {
    /**
     * Get the asset manager, corresponding to this fAsset.
     * fAssets and asset managers are in 1:1 correspondence.
     */
    address public override assetManager;
    
    /**
     * When f-asset is stopped, no transfers can be made anymore.
     * This is an extreme measure to be used only when the asset manager minting has been already paused
     * for a long time but there still exist unredeemable f-assets. In such case, the f-asset contract is
     * stopped and then agents can buy back the collateral at market rate (i.e. they burn market value
     * of backed f-assets in collateral to release the rest of the collateral).
     */
    bool public override stopped = false;
    
    modifier onlyAssetManager {
        require(msg.sender == assetManager, "only asset manager");
        _;
    }
    
    constructor(
        address _governance,
        string memory _name, 
        string memory _symbol,
        uint8 _decimals
    ) 
        VPToken(_governance, _name, _symbol)
    {
        _setupDecimals(_decimals);
    }
    
    /**
     * Set asset manager contract this can be done only once and must be just after deploy
     * (otherwise nothing can be minted).
     */
    function setAssetManager(address _assetManager)
        external
        onlyGovernance
    {
        require(_assetManager != address(0), "zero asset manager");
        require(assetManager == address(0), "cannot replace asset manager");
        assetManager = _assetManager;
    }
    
    /**
     * Mints `_amount` od fAsset.
     * Only the assetManager corresponding to this fAsset may call `mint()`.
     */
    function mint(address _owner, uint256 _amount) 
        external override
        onlyAssetManager
    {
        _mint(_owner, _amount);
    }
    
    /**
     * Burns `_amount` od fAsset.
     * Only the assetManager corresponding to this fAsset may call `burn()`.
     */
    function burn(address _owner, uint256 _amount)
        external override
        onlyAssetManager
    {
        _burn(_owner, _amount);
    }
    
    /**
     * Stops all transfers by setting `stopped` flag to true.
     * Only the assetManager corresponding to this fAsset may call `stop()`.
     */    
    function stop()
        external override
        onlyAssetManager
    {
        stopped = true;
    }

    /**
     * Prevent transfer if f-asset is stopped.
     */
    function _beforeTokenTransfer(
        address _from, 
        address _to, 
        uint256 _amount
    )
        internal
        override (VPToken)
    {
        require(!stopped, "f-asset stopped");
        VPToken._beforeTokenTransfer(_from, _to, _amount);
    }
}
