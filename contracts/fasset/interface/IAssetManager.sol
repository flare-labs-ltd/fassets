// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


interface IAssetManager {
    function withdrawCollateral(uint256 _valueNATWei) external;
    function destroyAgent(address _vaultAddress) external;
}
