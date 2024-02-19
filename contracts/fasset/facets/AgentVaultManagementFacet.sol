// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/assetManager/IAgentVaultManagement.sol";
import "../interfaces/IIAssetManager.sol";
import "../library/AgentsCreateDestroy.sol";
import "./AssetManagerBase.sol";


contract AgentVaultManagementFacet is AssetManagerBase, IAgentVaultManagement {
    /**
     * This method fixes the underlying address to be used by given agent owner.
     * A proof of payment (can be minimal or to itself) from this address must be provided,
     * with payment reference being equal to this method caller's address.
     * NOTE: calling this method before `createAgentVault()` is optional on most chains,
     * but is required on smart contract chains to make sure the agent is using EOA address
     * (depends on setting `requireEOAAddressProof`).
     * NOTE: may only be called by a whitelisted agent
     * @param _payment proof of payment on the underlying chain
     */
    function proveUnderlyingAddressEOA(
        Payment.Proof calldata _payment
    )
        external override
    {
        AgentsCreateDestroy.claimAddressWithEOAProof(_payment);
    }

    /**
     * Create an agent.
     * Agent will always be identified by `_agentVault` address.
     * (Externally, same account may own several agent vaults,
     *  but in fasset system, each agent vault acts as an independent agent.)
     * NOTE: may only be called by a whitelisted agent
     * @return _agentVault the new agent vault address
     */
    function createAgentVault(
        AddressValidity.Proof calldata _addressProof,
        AgentSettings.Data calldata _settings
    )
        external override
        onlyAttached
        returns (address _agentVault)
    {
        return AgentsCreateDestroy.createAgentVault(IIAssetManager(address(this)), _addressProof, _settings);
    }

    /**
     * Announce that the agent is going to be destroyed. At this time, agent must not have any mintings
     * or collateral reservations and must not be on the available agents list.
     * NOTE: may only be called by the agent vault owner.
     * @return _destroyAllowedAt the timestamp at which the destroy can be executed
     */
    function announceDestroyAgent(
        address _agentVault
    )
        external override
        returns (uint256 _destroyAllowedAt)
    {
        return AgentsCreateDestroy.announceDestroy(_agentVault);
    }

    /**
     * Delete all agent data, selfdestruct agent vault and send remaining collateral to the `_recipient`.
     * Procedure for destroying agent:
     * - exit available agents list
     * - wait until all assets are redeemed or perform self-close
     * - announce destroy (and wait the required time)
     * - call destroyAgent()
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the remaining funds from the vault will be transferred to the provided recipient.
     * @param _agentVault address of the agent's vault to destroy
     * @param _recipient address that receives the remaining funds and possible vault balance
     */
    function destroyAgent(
        address _agentVault,
        address payable _recipient
    )
        external override
    {
        AgentsCreateDestroy.destroyAgent(_agentVault, _recipient);
    }
}
