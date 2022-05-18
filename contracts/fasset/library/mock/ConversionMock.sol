// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Conversion} from "../Conversion.sol";
import "hardhat/console.sol";

/**
 * @title Conversion mock contract
 * @notice A contract to expose the Conversion library for unit testing.
 **/
contract ConversionMock {

    function convertAmgToNATWei(uint256 _valueAMG, uint256 _amgToNATWeiPrice) external pure returns (uint256) {
        return Conversion.convertAmgToNATWei(_valueAMG, _amgToNATWeiPrice);
    }

    function convertNATWeiToAMG(uint256 _valueNATWei, uint256 _amgToNATWeiPrice) external pure returns (uint256) {
        return Conversion.convertNATWeiToAMG(_valueNATWei, _amgToNATWeiPrice);
    }
}