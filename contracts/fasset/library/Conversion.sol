// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "../../utils/lib/SafePct.sol";
import "./AssetManagerSettings.sol";


library Conversion {
    using SafePct for uint256;
    
    uint256 internal constant AMG_TOKENWEI_PRICE_SCALE_EXP = 9;
    uint256 internal constant AMG_TOKENWEI_PRICE_SCALE = 10 ** AMG_TOKENWEI_PRICE_SCALE_EXP;
    uint256 internal constant NAT_WEI = 1e18;

    function currentAmgPriceInTokenWei(
        AssetManagerSettings.Settings storage _settings,
        uint256 _tokenType
    ) 
        internal view 
        returns (uint256) 
    {
        return currentAmgPriceInTokenWei(_settings, _settings.collateralTokens[_tokenType]);
    }

    function currentAmgPriceInTokenWei(
        AssetManagerSettings.Settings storage _settings,
        CollateralToken.Token storage _token
    ) 
        internal view 
        returns (uint256) 
    {
        IFtsoRegistry ftsoRegistry = _settings.ftsoRegistry;
        IIFtso assetFtso = ftsoRegistry.getFtso(_settings.assetFtsoIndex);
        IIFtso tokenFtso = ftsoRegistry.getFtso(_token.ftsoIndex);
        (uint256 assetPrice,, uint256 assetFtsoDecimals) = assetFtso.getCurrentPriceWithDecimals();
        (uint256 tokenPrice,, uint256 tokenFtsoDecimals) = tokenFtso.getCurrentPriceWithDecimals();
        return _calcAmgToTokenWeiPrice(_settings, _token.decimals, tokenPrice, tokenFtsoDecimals, 
            assetPrice, assetFtsoDecimals);
    }

    function currentAmgPriceInTokenWeiWithTrusted(
        AssetManagerSettings.Settings storage _settings,
        CollateralToken.Token storage _token
    ) 
        internal view 
        returns (uint256 _ftsoPrice, uint256 _trustedPrice) 
    {
        IFtsoRegistry ftsoRegistry = _settings.ftsoRegistry;
        IIFtso assetFtso = ftsoRegistry.getFtso(_settings.assetFtsoIndex);
        IIFtso tokenFtso = ftsoRegistry.getFtso(_token.ftsoIndex);
        (uint256 assetPrice, uint256 assetTimestamp, uint256 assetFtsoDecimals) = 
            assetFtso.getCurrentPriceWithDecimals();
        (uint256 tokenPrice, uint256 tokenTimestamp, uint256 tokenFtsoDecimals) = 
            tokenFtso.getCurrentPriceWithDecimals();
        // wee only need decimals once
        (uint256 assetPriceTrusted, uint256 assetTimestampTrusted) = assetFtso.getCurrentPriceFromTrustedProviders();
        (uint256 tokenPriceTrusted, uint256 tokenTimestampTrusted) = tokenFtso.getCurrentPriceFromTrustedProviders();
        _ftsoPrice = _calcAmgToTokenWeiPrice(_settings, _token.decimals, tokenPrice, tokenFtsoDecimals, 
            assetPrice, assetFtsoDecimals);
        _trustedPrice = tokenTimestampTrusted + _settings.maxTrustedPriceAgeSeconds >= tokenTimestamp
                && assetTimestampTrusted + _settings.maxTrustedPriceAgeSeconds >= assetTimestamp
            ? _calcAmgToTokenWeiPrice(_settings, _token.decimals, tokenPriceTrusted, tokenFtsoDecimals, 
                    assetPriceTrusted, assetFtsoDecimals)
            : _ftsoPrice;
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
    
    function convertAmgToTokenWei(uint256 _valueAMG, uint256 _amgToTokenWeiPrice) internal pure returns (uint256) {
        return _valueAMG.mulDiv(_amgToTokenWeiPrice, AMG_TOKENWEI_PRICE_SCALE);
    }

    function convertTokenWeiToAMG(uint256 _valueNATWei, uint256 _amgToTokenWeiPrice) internal pure returns (uint256) {
        return _valueNATWei.mulDiv(AMG_TOKENWEI_PRICE_SCALE, _amgToTokenWeiPrice);
    }

    function _calcAmgToTokenWeiPrice(
        AssetManagerSettings.Settings storage _settings,
        uint256 _tokenDecimals,
        uint256 _tokenPrice, 
        uint256 _tokenFtsoDecimals, 
        uint256 _assetPrice,
        uint256 _assetFtsoDecimals
    ) 
        private view 
        returns (uint256) 
    {
        uint256 expPlus = _tokenDecimals + _tokenFtsoDecimals + AMG_TOKENWEI_PRICE_SCALE_EXP;
        uint256 expMinus = _settings.assetMintingDecimals + _assetFtsoDecimals;
        // If negative, price would probably always be 0 after division, so this is forbidden.
        // Anyway, we should know about this before we add the token and/or asset, since
        // token decimals and ftso decimals typically never change.
        assert(expPlus >= expMinus);
        return _assetPrice.mulDiv(10 ** (expPlus - expMinus), _tokenPrice);
    }
}
