// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./IWNat.sol";

// Asset Manager methods used in AgentVault and AssetManagerController
interface IAssetManager {
    function updateSettings(bytes32 _method, bytes calldata _params) external;
    function attachController(bool attached) external;
    function pause() external;
    function unpause() external;
    function terminate() external;
    function withdrawCollateral(IERC20 _token, uint256 _amountWei) external;
    function updateCollateral(IERC20[] memory _tokens) external;
    function isCollateralToken(IERC20 _token) external view returns (bool);
    function getWNat() external view returns (IWNat);
    function assetManagerController() external view returns (address);
    function controllerAttached() external view returns (bool);
}
