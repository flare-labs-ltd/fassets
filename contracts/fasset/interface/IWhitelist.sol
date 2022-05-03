// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


interface IWhitelist {
    function isWhitelisted(address _address) external view returns (bool);   
}
