// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/AgentsExternal.sol";
import "../library/AgentsCreateDestroy.sol";
import "../library/FullAgentInfo.sol";
import "./AssetManagerBase.sol";


contract AgentInfoFacet is AssetManagerBase {
    /**
     * Get (a part of) the list of all agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAllAgents(
        uint256 _start,
        uint256 _end
    )
        external view
        returns (address[] memory _agents, uint256 _totalLength)
    {
        return AgentsExternal.getAllAgents(_start, _end);
    }

    /**
     * Check if the collateral pool token has been used already by some vault.
     * @param _suffix the suffix to check
     */
    function isPoolTokenSuffixReserved(string memory _suffix)
        external view
        returns (bool)
    {
        return AgentsCreateDestroy.isPoolTokenSuffixReserved(_suffix);
    }

    /**
     * Return basic info about an agent, typically needed by a minter.
     * @param _agentVault agent vault address
     * @return structure containing agent's minting fee (BIPS), min collateral ratio (BIPS),
     *      and current free collateral (lots)
     */
    function getAgentInfo(
        address _agentVault
    )
        external view
        returns (AgentInfo.Info memory)
    {
        return FullAgentInfo.getAgentInfo(_agentVault);
    }

    function getCollateralPool(address _agentVault)
        external view
        returns (address)
    {
        return address(Agent.get(_agentVault).collateralPool);
    }

    function getAgentVaultOwner(address _agentVault)
        external view
        returns (address _ownerManagementAddress)
    {
        return AgentsExternal.getAgentVaultOwner(_agentVault);
    }

    function getAgentVaultCollateralToken(address _agentVault)
        external view
        returns (IERC20)
    {
        return AgentsExternal.getVaultCollateralToken(_agentVault);
    }

    function getAgentFullVaultCollateral(address _agentVault)
        external view
        returns (uint256)
    {
        return AgentsExternal.getFullCollateral(_agentVault, Collateral.Kind.VAULT);
    }

    function getAgentFullPoolCollateral(address _agentVault)
        external view
        returns (uint256)
    {
        return AgentsExternal.getFullCollateral(_agentVault, Collateral.Kind.POOL);
    }

    function getAgentLiquidationFactorsAndMaxAmount(address _agentVault)
        external view
        returns (
            uint256 liquidationPaymentFactorVaultBIPS,
            uint256 liquidationPaymentFactorPoolBIPS,
            uint256 maxLiquidationAmountUBA
        )
    {
        return AgentsExternal.getLiquidationFactorsAndMaxAmount(_agentVault);
    }
}
