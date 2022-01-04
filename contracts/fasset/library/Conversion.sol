// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./AssetManagerSettings.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";

import {IFtsoRegistry} from "../../ScInterfaces/userInterfaces/IFtsoRegistry.sol";
import {IFtso} from "../../ScInterfaces/userInterfaces/IFtso.sol";


library Conversion {
    using SafePct for uint256;
    
    uint256 internal constant AMG_NATWEI_PRICE_SCALE = 1e9;
    uint256 internal constant NAT_WEI = 1e18;

    function calculateAmgToNATWeiPrice(
        AssetManagerSettings.Settings storage _settings
    ) internal view returns (uint256) 
    {
        IFtsoRegistry ftsoRegistry = _settings.priceSubmitter.getFtsoRegistry();
        (uint256 natPrice, ) = ftsoRegistry.getFtso(_settings.wnatAssetIndex).getCurrentPrice();
        (uint256 assetPrice, ) = ftsoRegistry.getFtso(_settings.assetIndex).getCurrentPrice();
        return amgToNATWeiPrice(_settings, natPrice, assetPrice);
    }

    function amgToNATWeiPrice(
        AssetManagerSettings.Settings storage _settings,
        uint256 _natPriceUSDDec5, 
        uint256 _assetPriceUSDDec5
    ) 
        internal view 
        returns (uint256) 
    {
        // _natPriceUSDDec5 < 2^128 (in ftso) and assetUnitUBA, are both 64 bit, so there can be no overflow
        return _assetPriceUSDDec5.mulDiv(_settings.assetMintingGranularityUBA * NAT_WEI * AMG_NATWEI_PRICE_SCALE,
                _natPriceUSDDec5 * _settings.assetUnitUBA);
    }
    
    function convertAmgToUBA(
        AssetManagerSettings.Settings storage _settings, 
        uint64 _valueAMG
    )
        internal view
        returns (uint256) 
    {
        // safe multiplication - both values are 64 bit
        return uint256(_valueAMG) * _settings.assetMintingGranularityUBA;
    }
    
    function convertAmgToNATWei(uint256 _valueAMG, uint256 _amgToNATWeiPrice) internal pure returns (uint256) {
        return _valueAMG.mulDiv(_amgToNATWeiPrice, AMG_NATWEI_PRICE_SCALE);
    }
}
