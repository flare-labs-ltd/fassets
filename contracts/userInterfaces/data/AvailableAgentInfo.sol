// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "./AgentInfo.sol";


library AvailableAgentInfo {
    struct Data {
        // Agent vault address.
        address agentVault;

        // The management address of the agent vault's owner.
        address ownerManagementAddress;

        // Agent's minting fee in BIPS.
        uint256 feeBIPS;

        // Minimum agent vault collateral ratio needed for minting.
        uint256 mintingVaultCollateralRatioBIPS;

        // Minimum pool collateral ratio needed for minting.
        uint256 mintingPoolCollateralRatioBIPS;

        // The number of lots that can be minted by this agent.
        // Note: the value is only informative since it can can change at any time
        // due to price changes, reservation, minting, redemption, or even lot size change.
        uint256 freeCollateralLots;

        // The agent status, as for getAgentInfo().
        AgentInfo.Status status;
    }
}
