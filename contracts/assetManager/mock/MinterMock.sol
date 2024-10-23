// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../interfaces/IIAssetManager.sol";


contract MinterMock {

    function receiveFunds() external payable {
        // do nothing
    }

    function reserveCollateral(
        IIAssetManager _assetManager,
        address _agentVault,
        uint256 _lots,
        uint256 _maxMintingFeeBIPS,
        address payable _executor,
        string[] calldata _minterUnderlyingAddresses
    ) external payable {
        _assetManager.reserveCollateral{value: msg.value}
        (_agentVault, _lots, _maxMintingFeeBIPS, _executor, _minterUnderlyingAddresses);
    }
}