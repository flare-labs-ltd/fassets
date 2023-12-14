// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interface/IPriceReader.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";

library Conversion {
    using SafePct for uint256;

    uint256 internal constant AMG_TOKEN_WEI_PRICE_SCALE_EXP = 9;
    uint256 internal constant AMG_TOKEN_WEI_PRICE_SCALE = 10 ** AMG_TOKEN_WEI_PRICE_SCALE_EXP;
    uint256 internal constant NAT_WEI = 1e18;
    uint256 internal constant GWEI = 1e9;

    function currentAmgPriceInTokenWei(
        uint256 _tokenType
    )
        internal view
        returns (uint256 _price)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        (_price,,) = currentAmgPriceInTokenWeiWithTs(state.collateralTokens[_tokenType], false);
    }

    function currentAmgPriceInTokenWei(
        CollateralTypeInt.Data storage _token
    )
        internal view
        returns (uint256 _price)
    {
        (_price,,) = currentAmgPriceInTokenWeiWithTs(_token, false);
    }

    function currentAmgPriceInTokenWeiWithTrusted(
        CollateralTypeInt.Data storage _token
    )
        internal view
        returns (uint256 _ftsoPrice, uint256 _trustedPrice)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        (uint256 ftsoPrice, uint256 assetTimestamp, uint256 tokenTimestamp) =
            currentAmgPriceInTokenWeiWithTs(_token, false);
        (uint256 trustedPrice, uint256 assetTimestampTrusted, uint256 tokenTimestampTrusted) =
            currentAmgPriceInTokenWeiWithTs(_token, true);
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

    function roundUBAToAmg(
        uint256 _valueUBA
    )
        internal view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        return _valueUBA - (_valueUBA % settings.assetMintingGranularityUBA);
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

    function convert(
        uint256 _amount,
        CollateralTypeInt.Data storage _fromToken,
        CollateralTypeInt.Data storage _toToken
    )
        internal view
        returns (uint256)
    {
        uint256 priceMul = currentAmgPriceInTokenWei(_toToken);
        uint256 priceDiv = currentAmgPriceInTokenWei(_fromToken);
        return _amount.mulDiv(priceMul, priceDiv);
    }

    function convertFromUSD5(
        uint256 _amountUSD5,
        CollateralTypeInt.Data storage _token
    )
        internal view
        returns (uint256)
    {
        // if tokenFtsoSymbol is empty, it is assumed that the token is a USD-like stablecoin
        // so `_amountUSD5` is (approximately) the correct amount of tokens
        if (bytes(_token.tokenFtsoSymbol).length == 0) {
            return _amountUSD5;
        }
        (uint256 tokenPrice,, uint256 tokenFtsoDec) = readFtsoPrice(_token.tokenFtsoSymbol, false);
        // 5 is for 5 decimals of USD5
        uint256 expPlus = _token.decimals + tokenFtsoDec - 5;
        return _amountUSD5.mulDiv(10 ** expPlus, tokenPrice);
    }

    function currentAmgPriceInTokenWeiWithTs(
        CollateralTypeInt.Data storage _token,
        bool _fromTrustedProviders
    )
        internal view
        returns (uint256 /*_price*/, uint256 /*_assetTimestamp*/, uint256 /*_tokenTimestamp*/)
    {
        (uint256 assetPrice, uint256 assetTs, uint256 assetFtsoDec) =
            readFtsoPrice(_token.assetFtsoSymbol, _fromTrustedProviders);
        if (_token.directPricePair) {
            uint256 price = calcAmgToTokenWeiPrice(_token.decimals, 1, 0, assetPrice, assetFtsoDec);
            return (price, assetTs, assetTs);
        } else {
            (uint256 tokenPrice, uint256 tokenTs, uint256 tokenFtsoDec) =
                readFtsoPrice(_token.tokenFtsoSymbol, _fromTrustedProviders);
            uint256 price =
                calcAmgToTokenWeiPrice(_token.decimals, tokenPrice, tokenFtsoDec, assetPrice, assetFtsoDec);
            return (price, assetTs, tokenTs);
        }
    }

    function readFtsoPrice(string memory _symbol, bool _fromTrustedProviders)
        internal view
        returns (uint256, uint256, uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        IPriceReader priceReader = IPriceReader(settings.priceReader);
        if (_fromTrustedProviders) {
            return priceReader.getPriceFromTrustedProviders(_symbol);
        } else {
            return priceReader.getPrice(_symbol);
        }
    }

    function calcAmgToTokenWeiPrice(
        uint256 _tokenDecimals,
        uint256 _tokenPrice,
        uint256 _tokenFtsoDecimals,
        uint256 _assetPrice,
        uint256 _assetFtsoDecimals
    )
        internal view
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

    function convertAmgToTokenWei(uint256 _valueAMG, uint256 _amgToTokenWeiPrice) internal pure returns (uint256) {
        return _valueAMG.mulDiv(_amgToTokenWeiPrice, AMG_TOKEN_WEI_PRICE_SCALE);
    }

    function convertTokenWeiToAMG(uint256 _valueNATWei, uint256 _amgToTokenWeiPrice) internal pure returns (uint256) {
        return _valueNATWei.mulDiv(AMG_TOKEN_WEI_PRICE_SCALE, _amgToTokenWeiPrice);
    }
}
