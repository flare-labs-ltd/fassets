// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


library SafeMathX {
    uint256 internal constant MAX_UINT192 = (1 << 192) - 1;
    
    function toUint192(uint256 a) internal pure returns (uint192) {
        require(a <= MAX_UINT192, "SafeMathX: conversion overflow");
        return uint192(a);
    }
}
