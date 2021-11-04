// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

library SafeMath64 {
    uint256 internal constant MAX_UINT64 = (1 << 64) - 1;
    
    function toUint64(uint256 a) internal pure returns (uint64) {
        require(a <= MAX_UINT64, "SafeMath64: conversion overflow");
        return uint64(a);
    }

    function add64(uint256 a, uint256 b) internal pure returns (uint64) {
        uint256 c = a + b;
        require(a <= MAX_UINT64 && b <= MAX_UINT64 && c <= MAX_UINT64, "SafeMath64: addition overflow");
        return uint64(c);
    }

    function sub64(uint256 a, uint256 b, string memory message) internal pure returns (uint64) {
        require(a >= b, message);
        uint256 c = a - b;
        require(c <= MAX_UINT64, "SafeMath64: sub above 64bit");
        return uint64(c);
    }
}
