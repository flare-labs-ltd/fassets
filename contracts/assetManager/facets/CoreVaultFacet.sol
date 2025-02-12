// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../library/CoreVault.sol";
import "./AssetManagerBase.sol";


contract CoreVaultFacet is AssetManagerBase, ReentrancyGuard {
    /**
     * Agent can transfer their backing to core vault.
     * They then get a redemption requests which the owner pays just like any other redemption request.
     * After that, the agent's collateral is released.
     * @param _agentVault the agent vault address
     * @param _amountUBA the amount to transfer to the core vault
     */
    function transferToCoreVault(
        address _agentVault,
        uint256 _amountUBA
    )
        external payable
        nonReentrant
        onlyAgentVaultOwner(_agentVault)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        uint64 amountAMG = Conversion.convertUBAToAmg(_amountUBA);
        CoreVault.transferToCoreVault(agent, amountAMG);
    }
}
