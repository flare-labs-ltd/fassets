// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


library SafeMathX {
    uint256 internal constant MAX_UINT192 = (1 << 192) - 1;
    uint256 internal constant MAX_INT256 = (1 << 255) - 1;
    
    function toUint192(uint256 a) internal pure returns (uint192) {
        require(a <= MAX_UINT192, "SafeMathX: conversion overflow");
        return uint192(a);
    }
    
    function toInt256(uint256 a) internal pure returns (int256) {
        require(a <= MAX_INT256, "SafeMathX: conversion overflow");
        return int256(a);
    }

    function toUint256(int256 a) internal pure returns (uint256) {
        require(a >= 0, "SafeMathX: negative value");
        return uint256(a);
    }
}
