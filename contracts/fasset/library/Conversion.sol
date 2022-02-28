// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtso.sol";
import "../../utils/lib/SafePct.sol";
import "./AssetManagerSettings.sol";


library Conversion {
    using SafePct for uint256;
    
    uint256 internal constant AMG_NATWEI_PRICE_SCALE = 1e9;
    uint256 internal constant NAT_WEI = 1e18;

    function currentAmgToNATWeiPrice(
        AssetManagerSettings.Settings storage _settings
    ) 
        internal view 
        returns (uint256) 
    {
        // Force cast here to circument architecure in original contracts 
        (uint256 natPrice, ) = _settings.natFtso.getCurrentPrice();
        (uint256 assetPrice, ) = _settings.assetFtso.getCurrentPrice();
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

    function convertUBAToAmg(
        AssetManagerSettings.Settings storage _settings, 
        uint256 _valueUBA
    )
        internal view
        returns (uint64) 
    {
        return SafeCast.toUint64(_valueUBA / _settings.assetMintingGranularityUBA);
    }
    
    function convertLotsToUBA(
        AssetManagerSettings.Settings storage _settings, 
        uint64 _lots
    )
        internal view
        returns (uint256) 
    {
        // safe multiplication - all values are 64 bit
        return uint256(_lots) * _settings.lotSizeAMG * _settings.assetMintingGranularityUBA;
    }
    
    function convertAmgToNATWei(uint256 _valueAMG, uint256 _amgToNATWeiPrice) internal pure returns (uint256) {
        return _valueAMG.mulDiv(_amgToNATWeiPrice, AMG_NATWEI_PRICE_SCALE);
    }
}
