// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "./AssetManagerSettings.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";

library Conversion {
    using SafePct for uint256;
    
    uint256 internal constant AMG_NATWEI_PRICE_SCALE = 1e9;
    uint256 internal constant NAT_WEI = 1e18;

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
    
    function convertAmgToNATWei(uint256 _valueAMG, uint256 _amgToNATWeiPrice) internal pure returns (uint256) {
        return _valueAMG.mulDiv(_amgToNATWeiPrice, AMG_NATWEI_PRICE_SCALE);
    }
}
