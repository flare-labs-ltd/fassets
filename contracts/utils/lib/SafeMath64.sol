// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


library SafeMath64 {
    uint256 internal constant MAX_UINT64 = type(uint64).max;
    int256 internal constant MAX_INT64 = type(int64).max;
    
    // 64 bit signed/unsigned conversion
    
    function toUint64(int256 a) internal pure returns (uint64) {
        require(a >= 0, "SafeMath64: negative value");
        require(a <= int256(MAX_UINT64), "SafeMath64: conversion overflow");
        return uint64(a);
    }

    function toInt64(uint256 a) internal pure returns (int64) {
        require(a <= uint256(MAX_INT64), "SafeMath64: conversion overflow");
        return int64(a);
    }
    
    // 64 bit arithmetic - no need for 256 bit overflow checks
    
    function add64(uint64 a, uint64 b) internal pure returns (uint64) {
        uint256 c = uint256(a) + uint256(b);    // fits into 65 bits
        require(c <= MAX_UINT64, "SafeMath64: addition overflow");
        return uint64(c);
    }

    function sub64(uint64 a, uint64 b, string memory message) internal pure returns (uint64) {
        require(a >= b, message);
        uint256 c = uint256(a) - uint256(b);
        return uint64(c);
    }
    
    function mul64(uint64 a, uint64 b) internal pure returns (uint64) {
        uint256 c = uint256(a) * uint256(b);    // fits into 128 bits
        require(c <= MAX_UINT64, "SafeMath64: mul overflow");
        return uint64(c);
    }

    function div64(uint64 a, uint64 b) internal pure returns (uint64) {
        require(b != 0, "SafeMath64: div by zero");
        return a / b;
    }
    
    function min64(uint64 a, uint64 b) internal pure returns (uint64) {
        return a <= b ? a : b;
    }

    // // functions that add/subtract and cast result from 256 bits to 64 bits
        
    // function add64(uint256 a, uint256 b) internal pure returns (uint64) {
    //     uint256 c = a + b;
    //     require(a <= MAX_UINT64 && b <= MAX_UINT64 && c <= MAX_UINT64, "SafeMath64: addition overflow");
    //     return uint64(c);
    // }

    // function sub64(uint256 a, uint256 b, string memory message) internal pure returns (uint64) {
    //     require(a >= b, message);
    //     uint256 c = a - b;
    //     require(c <= MAX_UINT64, "SafeMath64: sub above 64bit");
    //     return uint64(c);
    // }

    // cheaper version of safe mulDiv - no need for handling uint256 overflow
    
    function mulDiv(uint64 a, uint64 mul, uint256 div) internal pure returns (uint256) {
        require(div != 0, "SafeMath64: mulDiv by zero");
        return (uint256(a) * uint256(mul)) / div; // intermediate values limited to 128 bits
    }
}
