// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";

library Conversion {
    using SafePct for uint256;

    uint256 internal constant AMG_TOKEN_WEI_PRICE_SCALE_EXP = 9;
    uint256 internal constant AMG_TOKEN_WEI_PRICE_SCALE = 10 ** AMG_TOKEN_WEI_PRICE_SCALE_EXP;
    uint256 internal constant NAT_WEI = 1e18;

    function currentAmgPriceInTokenWei(
        uint256 _tokenType
    )
        internal view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return currentAmgPriceInTokenWei(state.collateralTokens[_tokenType]);
    }

    function currentAmgPriceInTokenWei(
        CollateralToken.Data storage _token
    )
        internal view
        returns (uint256 _price)
    {
        (_price,,) = _currentAmgPriceInTokenWeiWithTs(_token);
    }

    function currentAmgPriceInTokenWeiWithTrusted(
        CollateralToken.Data storage _token
    )
        internal view
        returns (uint256 _ftsoPrice, uint256 _trustedPrice)
    {
        (uint256 ftsoPrice, uint256 assetTimestamp, uint256 tokenTimestamp) =
            _currentAmgPriceInTokenWeiWithTs(_token);
        (uint256 trustedPrice, uint256 assetTimestampTrusted, uint256 tokenTimestampTrusted) =
            _currentTrustedAmgPriceInTokenWeiWithTs(_token);
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        bool trustedPriceFresh = tokenTimestampTrusted + settings.maxTrustedPriceAgeSeconds >= tokenTimestamp
                && assetTimestampTrusted + settings.maxTrustedPriceAgeSeconds >= assetTimestamp;
        _ftsoPrice = ftsoPrice;
        _trustedPrice = trustedPriceFresh ? trustedPrice : ftsoPrice;
    }

    function convertAmgToUBA(
        uint64 _valueAMG
    )
        internal view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        // safe multiplication - both values are 64 bit
        return uint256(_valueAMG) * settings.assetMintingGranularityUBA;
    }

    function convertUBAToAmg(
        uint256 _valueUBA
    )
        internal view
        returns (uint64)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        return SafeCast.toUint64(_valueUBA / settings.assetMintingGranularityUBA);
    }

    function convertLotsToUBA(
        uint64 _lots
    )
        internal view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        // safe multiplication - all values are 64 bit
        return uint256(_lots) * settings.lotSizeAMG * settings.assetMintingGranularityUBA;
    }

    function currentWeiPriceRatio(
        CollateralToken.Data storage _token1,
        CollateralToken.Data storage _token2
    )
        internal view
        returns (uint256 _multiplier, uint256 _divisor)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        IFtsoRegistry ftsoRegistry = settings.ftsoRegistry;
        IIFtso token1Ftso = ftsoRegistry.getFtso(_token1.ftsoIndex);
        IIFtso token2Ftso = ftsoRegistry.getFtso(_token2.ftsoIndex);
        (uint256 token1Price,, uint256 token1FtsoDec) = token1Ftso.getCurrentPriceWithDecimals();
        (uint256 token2Price,, uint256 token2FtsoDec) = token2Ftso.getCurrentPriceWithDecimals();
        uint256 expPlus = _token2.decimals + token2FtsoDec;
        uint256 expMinus = _token1.decimals + token1FtsoDec;
        expPlus -= Math.min(expPlus, expMinus);
        expMinus -= Math.min(expPlus, expMinus);
        _multiplier = token1Price * 10 ** expPlus;
        _divisor = token2Price * 10 ** expMinus;
    }

    function convertAmgToTokenWei(uint256 _valueAMG, uint256 _amgToTokenWeiPrice) internal pure returns (uint256) {
        return _valueAMG.mulDiv(_amgToTokenWeiPrice, AMG_TOKEN_WEI_PRICE_SCALE);
    }

    function convertTokenWeiToAMG(uint256 _valueNATWei, uint256 _amgToTokenWeiPrice) internal pure returns (uint256) {
        return _valueNATWei.mulDiv(AMG_TOKEN_WEI_PRICE_SCALE, _amgToTokenWeiPrice);
    }

    function _currentAmgPriceInTokenWeiWithTs(CollateralToken.Data storage _token)
        private view
        returns (uint256 /*_price*/, uint256 /*_assetTs*/, uint256 /*_tokenTs*/)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        IFtsoRegistry ftsoRegistry = settings.ftsoRegistry;
        IIFtso assetFtso = ftsoRegistry.getFtso(settings.assetFtsoIndex);
        IIFtso tokenFtso = ftsoRegistry.getFtso(_token.ftsoIndex);
        (uint256 assetPrice, uint256 assetTs, uint256 assetFtsoDec) = assetFtso.getCurrentPriceWithDecimals();
        (uint256 tokenPrice, uint256 tokenTs, uint256 tokenFtsoDec) = tokenFtso.getCurrentPriceWithDecimals();
        uint256 price = _calcAmgToTokenWeiPrice(_token.decimals, tokenPrice, tokenFtsoDec, assetPrice, assetFtsoDec);
        return (price, assetTs, tokenTs);
    }

    function _currentTrustedAmgPriceInTokenWeiWithTs(CollateralToken.Data storage _token)
        private view
        returns (uint256 /*_price*/, uint256 /*_assetTs*/, uint256 /*_tokenTs*/)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        IFtsoRegistry ftsoRegistry = settings.ftsoRegistry;
        IIFtso assetFtso = ftsoRegistry.getFtso(settings.assetFtsoIndex);
        IIFtso tokenFtso = ftsoRegistry.getFtso(_token.ftsoIndex);
        (uint256 assetPrice, uint256 assetTs, uint256 assetFtsoDec) =
            assetFtso.getCurrentPriceWithDecimalsFromTrustedProviders();
        (uint256 tokenPrice, uint256 tokenTs, uint256 tokenFtsoDec) =
            tokenFtso.getCurrentPriceWithDecimalsFromTrustedProviders();
        uint256 price = _calcAmgToTokenWeiPrice(_token.decimals, tokenPrice, tokenFtsoDec, assetPrice, assetFtsoDec);
        return (price, assetTs, tokenTs);
    }

    function _calcAmgToTokenWeiPrice(
        uint256 _tokenDecimals,
        uint256 _tokenPrice,
        uint256 _tokenFtsoDecimals,
        uint256 _assetPrice,
        uint256 _assetFtsoDecimals
    )
        private view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        uint256 expPlus = _tokenDecimals + _tokenFtsoDecimals + AMG_TOKEN_WEI_PRICE_SCALE_EXP;
        uint256 expMinus = settings.assetMintingDecimals + _assetFtsoDecimals;
        // If negative, price would probably always be 0 after division, so this is forbidden.
        // Anyway, we should know about this before we add the token and/or asset, since
        // token decimals and ftso decimals typically never change.
        assert(expPlus >= expMinus);
        return _assetPrice.mulDiv(10 ** (expPlus - expMinus), _tokenPrice);
    }
}
