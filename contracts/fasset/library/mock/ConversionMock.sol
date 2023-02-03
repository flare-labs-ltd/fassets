// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Conversion} from "../Conversion.sol";

/**
 * @title Conversion mock contract
 * @notice A contract to expose the Conversion library for unit testing.
 **/
contract ConversionMock {

    function convertAmgToTokenWei(uint256 _valueAMG, uint256 _amgToNATWeiPrice) external pure returns (uint256) {
        return Conversion.convertAmgToTokenWei(_valueAMG, _amgToNATWeiPrice);
    }

    function convertTokenWeiToAMG(uint256 _valueNATWei, uint256 _amgToNATWeiPrice) external pure returns (uint256) {
        return Conversion.convertTokenWeiToAMG(_valueNATWei, _amgToNATWeiPrice);
    }
}
