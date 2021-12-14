// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


library SafeMath128 {
    uint256 internal constant MAX_UINT128 = type(uint128).max;
    int256 internal constant MAX_INT128 = type(int128).max;
    
    // 128 bit signed/unsigned conversion
    
    function toUint128(int256 a) internal pure returns (uint128) {
        require(a >= 0, "SafeMath128: negative value");
        require(a <= int256(MAX_UINT128), "SafeMath128: conversion overflow");
        return uint128(a);
    }

    function toInt128(uint256 a) internal pure returns (int128) {
        require(a <= uint256(MAX_INT128), "SafeMath128: conversion overflow");
        return int128(a);
    }
    
    // 128 bit arithmetic
    
    function add128(uint128 a, uint128 b) internal pure returns (uint128) {
        uint256 c = uint256(a) + uint256(b);
        require(c <= MAX_UINT128, "SafeMath128: addition overflow");
        return uint128(c);
    }

    function sub128(uint128 a, uint128 b, string memory message) internal pure returns (uint128) {
        require(a >= b, message);
        uint256 c = uint256(a) - uint256(b);
        return uint128(c);
    }
    
    function mul128(uint128 a, uint128 b) internal pure returns (uint128) {
        uint256 c = uint256(a) * uint256(b);    // fits into 256 bits
        require(c <= MAX_UINT128, "SafeMath128: mul overflow");
        return uint128(c);
    }

    // // functions that simultaneously add/sub and cast from 256 bits to 128 bits
        
    // function add128(uint256 a, uint256 b) internal pure returns (uint128) {
    //     uint256 c = a + b;
    //     require(a <= MAX_UINT128 && b <= MAX_UINT128 && c <= MAX_UINT128, "SafeMath128: addition overflow");
    //     return uint128(c);
    // }

    // function sub128(uint256 a, uint256 b, string memory message) internal pure returns (uint128) {
    //     require(a >= b, message);
    //     uint256 c = a - b;
    //     require(c <= MAX_UINT128, "SafeMath128: sub above 128bit");
    //     return uint128(c);
    // }

    // cheaper version of safe mulDiv - no need for handling uint256 overflow
    
    function mulDiv(uint128 a, uint128 mul, uint256 div) internal pure returns (uint256) {
        require(div != 0, "SafeMath128: mulDiv by zero");
        return (uint256(a) * uint256(mul)) / div; // intermediate values limited to 256 bits
    }
}
