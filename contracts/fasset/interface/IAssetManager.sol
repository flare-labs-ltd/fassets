// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IAssetManager {
    function withdrawCollateral(uint256 _valueNATWei) external;
    function canDestroy(address _vaultAddress) external view returns (bool);
}
