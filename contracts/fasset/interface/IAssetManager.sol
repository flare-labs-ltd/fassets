// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IWNat.sol";

// Asset Manager methods used in AgentVault and AssetManagerController
interface IAssetManager {
    function updateSettings(bytes32 _method, bytes calldata _params) external;
    function pause() external;
    function terminate() external;
    function withdrawCollateral(uint256 _valueNATWei) external;
    function depositCollateral(uint256 _valueNATWei) external;
    function getWNat() external view returns (IWNat);
}
