// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


interface IWhitelist {
    function isWhitelisted(address _account) external view returns (bool);   
}
