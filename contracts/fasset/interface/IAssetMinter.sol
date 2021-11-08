// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;


interface IAssetMinter {
    function maxWithdrawAllowed(address vaultAddress) external view returns (uint256);
    function canDestroy(address vaultAddress) external view returns (bool);
}
