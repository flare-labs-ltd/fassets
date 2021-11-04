// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

interface IAssetManager {
    function maxWithdrawAllowed(address vaultAddress) external view returns (uint256);
    function canDestroy(address vaultAddress) external view returns (bool);
}
