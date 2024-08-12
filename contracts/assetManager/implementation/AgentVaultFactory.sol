// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;


import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "../interfaces/IAgentVaultFactory.sol";
import "./AgentVault.sol";


contract AgentVaultFactory is IAgentVaultFactory, IERC165 {
    address public implementation;

    constructor(address _implementation) {
        implementation = _implementation;
    }

    /**
     * @notice Creates new agent vault
     */
    function create(IIAssetManager _assetManager) external returns (IIAgentVault) {
        address clone = Clones.clone(implementation);
        AgentVault agentVault = AgentVault(payable(clone));
        agentVault.initialize(_assetManager);
        return agentVault;
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
