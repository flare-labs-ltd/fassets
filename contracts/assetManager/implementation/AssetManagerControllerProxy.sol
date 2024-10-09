// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/proxy/Proxy.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "flare-smart-contracts/contracts/userInterfaces/IGovernanceSettings.sol";
import "./AssetManagerController.sol";


contract AssetManagerControllerProxy is ERC1967Proxy {
    constructor(
        address _implementationAddress,
        IGovernanceSettings _governanceSettings,
        address _initialGovernance,
        address _addressUpdater
    )
        ERC1967Proxy(_implementationAddress,
            abi.encodeCall(
                AssetManagerController.initialize,
                (_governanceSettings, _initialGovernance, _addressUpdater)
            )
        )
    {
    }
}
