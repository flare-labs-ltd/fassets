// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;


interface IAssetManager {
    function withdrawCollateral(uint256 _valueNATWei) external;
    function destroyAgent(address _vaultAddress) external;
}
