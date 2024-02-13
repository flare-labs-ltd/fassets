// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

interface IIAssetManagerController {
    function reserveTokenSymbolSuffix(string memory _suffix)
        external
        returns (uint256 _index);
}
