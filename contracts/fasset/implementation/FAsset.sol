// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "../../../cache/flattened/VPToken.sol";
import "../interface/IFAsset.sol";

contract FAsset is IFAsset, VPToken {
    /**
     * Get the asset manager, corresponding to this fAsset.
     * fAssets and asset managers are in 1:1 correspondence.
     */
    address public immutable override assetManager;
    
    modifier onlyAssetManager {
        require(msg.sender == assetManager, "only asset manager");
        _;
    }
    
    constructor(
        address _governance,
        string memory _name, 
        string memory _symbol,
        uint8 _decimals,
        address _assetManager
    ) 
        VPToken(_governance, _name, _symbol)
    {
        assetManager = _assetManager;
        _setupDecimals(_decimals);
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
}
