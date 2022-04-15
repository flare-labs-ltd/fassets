// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


interface IWhitelist {
    function whitelisted(address _account) external view returns (bool);
}
