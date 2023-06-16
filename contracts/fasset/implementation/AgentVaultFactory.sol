// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;


import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../interface/IAgentVaultFactory.sol";
import "./AgentVault.sol";


contract AgentVaultFactory is IAgentVaultFactory, IERC165 {
    /**
     * @notice Creates new agent vault
     */
    function create(IIAssetManager _assetManager) external returns (IIAgentVault) {
        return new AgentVault(_assetManager);
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IAgentVaultFactory).interfaceId;
    }
}
