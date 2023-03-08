// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;


interface ILiquidationStrategy {
    function initialize(bytes memory _encodedSettings) external;

    function updateSettings(bytes memory _encodedSettings) external;

    function getSettings()
        external view
        returns (bytes memory);

    function currentLiquidationFactorBIPS(address _agentVault, uint256 _class1CR, uint256 _poolCR)
        external view
        returns (uint256 _c1FactorBIPS, uint256 _poolFactorBIPS);
}
