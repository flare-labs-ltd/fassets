// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../stateConnector/interfaces/ISCProofVerifier.sol";
import "../data/AgentSettings.sol";

/**
 * Methods for creating and destroying agent vaults.
 */
interface IAgentVaultManagement {
    /**
     * This method fixes the underlying address to be used by given agent owner.
     * A proof of payment (can be minimal or to itself) from this address must be provided,
     * with payment reference being equal to this method caller's address.
     * NOTE: calling this method before `createAgentVault()` is optional on most chains,
     * but is required on smart contract chains to make sure the agent is using EOA address
     * (depends on setting `requireEOAAddressProof`).
     * NOTE: may only be called by a whitelisted agent (management or work owner address).
     * @param _payment proof of payment on the underlying chain
     */
    function proveUnderlyingAddressEOA(
        Payment.Proof calldata _payment
    ) external;

    /**
     * Create an agent vault.
     * The agent will always be identified by `_agentVault` address.
     * (Externally, one account may own several agent vaults,
     *  but in fasset system, each agent vault acts as an independent agent.)
     * NOTE: may only be called by an agent on the allowed agent list.
     * Can be called from the management or the work agent owner address.
     * @return _agentVault new agent vault address
     */
    function createAgentVault(
        AddressValidity.Proof calldata _addressProof,
        AgentSettings.Data calldata _settings
    ) external
        returns (address _agentVault);

    /**
     * Announce that the agent is going to be destroyed. At this time, the agent must not have any mintings
     * or collateral reservations and must not be on the available agents list.
     * NOTE: may only be called by the agent vault owner.
     * @return _destroyAllowedAt the timestamp at which the destroy can be executed
     */
    function announceDestroyAgent(
        address _agentVault
    ) external
        returns (uint256 _destroyAllowedAt);

    /**
     * Delete all agent data, self destruct agent vault and send remaining collateral to the `_recipient`.
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
    ) external;
}
