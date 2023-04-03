// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../data/AssetManagerState.sol";
import {Conversion} from "../Conversion.sol";

/**
 * @title Conversion mock contract
 * @notice A contract to expose the Conversion library for unit testing.
 **/
contract ConversionMock {
    function setAssetDecimals(uint256 assetDecimals, uint256 assetMintingDecimals) external {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        settings.assetDecimals = SafeCast.toUint8(assetDecimals);
        settings.assetMintingDecimals = SafeCast.toUint8(assetMintingDecimals);
        settings.assetUnitUBA = SafeCast.toUint64(10 ** assetDecimals);
        settings.assetMintingGranularityUBA = SafeCast.toUint64(10 ** (assetDecimals - assetMintingDecimals));
    }

    function calcAmgToTokenWeiPrice(uint256 _tokenDecimals, uint256 _tokenPrice, uint256 _tokenFtsoDecimals,
        uint256 _assetPrice, uint256 _assetFtsoDecimals
    ) external view returns (uint256) {
        return Conversion.calcAmgToTokenWeiPrice(_tokenDecimals, _tokenPrice, _tokenFtsoDecimals,
            _assetPrice, _assetFtsoDecimals);
    }

    function convertAmgToTokenWei(uint256 _valueAMG, uint256 _amgToNATWeiPrice) external pure returns (uint256) {
        return Conversion.convertAmgToTokenWei(_valueAMG, _amgToNATWeiPrice);
    }

    function convertTokenWeiToAMG(uint256 _valueNATWei, uint256 _amgToNATWeiPrice) external pure returns (uint256) {
        return Conversion.convertTokenWeiToAMG(_valueNATWei, _amgToNATWeiPrice);
    }
}
