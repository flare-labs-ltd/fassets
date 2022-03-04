// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IWNat.sol";

// Asset Manager methods used in AgentVault
interface IAssetManager {
    function withdrawCollateral(uint256 _valueNATWei) external;
    function getWNat() external view returns (IWNat);
}
