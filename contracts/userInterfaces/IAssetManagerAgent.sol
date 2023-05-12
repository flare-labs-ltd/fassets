// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../generated/interface/IAttestationClient.sol";
import "./data/AgentInfo.sol";
import "./data/AgentCreateSettings.sol";


/**
 * Agent management and information.
 * All management methods here must be called by the agent owner.
 */
interface IAssetManagerAgent {
    ////////////////////////////////////////////////////////////////////////////////////
    // Owner cold and hot address management

    /**
     * Associate a hot wallet address with agent owner's cold owner address.
     * Every owner (cold address) can have only one hot address, so as soon as the new one is set, the old
     * one stops working.
     * NOTE: May only be called by a whitelisted agent and only from the cold address.
     */
    function setOwnerHotAddress(address _ownerHotAddress) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent create / destroy

    /**
     * This method fixes the underlying address to be used by given agent owner.
     * A proof of payment (can be minimal or to itself) from this address must be provided,
     * with payment reference being equal to this method caller's address.
     * NOTE: calling this method before `createAgent()` is optional on most chains,
     * but is required on smart contract chains to make sure the agent is using EOA address
     * (depends on setting `requireEOAAddressProof`).
     * NOTE: may only be called by a whitelisted agent (cold or hot owner address).
     * @param _payment proof of payment on the underlying chain
     */
    function proveUnderlyingAddressEOA(
        IAttestationClient.Payment calldata _payment
    ) external;

    /**
     * Create an agent.
     * Agent will always be identified by `_agentVault` address.
     * (Externally, same account may own several agent vaults,
     *  but in fasset system, each agent vault acts as an independent agent.)
     * NOTE: may only be called by a whitelisted agent (cold or hot owner address).
     */
    function createAgent(
        AgentCreateSettings.Data calldata _settings
    ) external;

    /**
     * Announce that the agent is going to be destroyed. At this time, agent must not have any mintings
     * or collateral reservations and must not be on the available agents list.
     * NOTE: may only be called by the agent vault owner.
     */
    function announceDestroyAgent(
        address _agentVault
    ) external;

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
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent settings update

    /**
     * Due to effect on the pool, all agent settings are timelocked.
     * This method announces a setting change. The change can be executed after the timelock expires.
     * NOTE: may only be called by the agent vault owner.
     */
    function announceAgentSettingUpdate(
        address _agentVault,
        string memory _name,
        uint256 _value
    ) external;

    /**
     * Due to effect on the pool, all agent settings are timelocked.
     * This method executes a setting change after the timelock expired.
     * NOTE: may only be called by the agent vault owner.
     */
    function executeAgentSettingUpdate(
        address _agentVault,
        string memory _name
    ) external;

    /**
     * When current pool collateral token contract (WNat) is replaced by the method setPoolCollateralType,
     * pools don't switch automatically. Instead, the agent must call this method that swaps old WNat tokens for
     * new ones and sets it for use by the pool.
     * NOTE: may only be called by the agent vault owner.
     */
    function upgradeWNatContract(
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Collateral withdrawal announcement

    /**
     * Agent is going to withdraw `_valueNATWei` amount of collateral from agent vault.
     * This has to be announced and agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, agent can call withdraw(_valueNATWei) on agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     */
    function announceClass1CollateralWithdrawal(
        address _agentVault,
        uint256 _valueNATWei
    ) external;

    /**
     * Agent is going to withdraw `_valueNATWei` amount of collateral from agent vault.
     * This has to be announced and agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, agent can call withdraw(_valueNATWei) on agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     */
    function announceAgentPoolTokenRedemption(
        address _agentVault,
        uint256 _valueNATWei
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying balance topup

    /**
     * When the agent tops up his underlying address, it has to be confirmed by calling this method,
     * which updates the underlying free balance value.
     * NOTE: may only be called by the agent vault owner.
     * @param _payment proof of the underlying payment; must include payment
     *      reference of the form `0x4642505266410011000...0<agents_vault_address>`
     * @param _agentVault agent vault address
     */
    function confirmTopupPayment(
        IAttestationClient.Payment calldata _payment,
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Underlying withdrawal announcements

    /**
     * Announce withdrawal of underlying currency.
     * In the event UnderlyingWithdrawalAnnounced the agent receives payment reference, which must be
     * added to the payment, otherwise it can be challenged as illegal.
     * Until the announced withdrawal is performed and confirmed or cancelled, no other withdrawal can be announced.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function announceUnderlyingWithdrawal(
        address _agentVault
    ) external;

    /**
     * Agent must provide confirmation of performed underlying withdrawal, which updates free balance with used gas
     * and releases announcement so that a new one can be made.
     * If the agent doesn't call this method, anyone can call it after a time (confirmationByOthersAfterSeconds).
     * NOTE: may only be called by the owner of the agent vault
     *   except if enough time has passed without confirmation - then it can be called by anybody.
     * @param _payment proof of the underlying payment
     * @param _agentVault agent vault address
     */
    function confirmUnderlyingWithdrawal(
        IAttestationClient.Payment calldata _payment,
        address _agentVault
    ) external;

    /**
     * Cancel ongoing withdrawal of underlying currency.
     * Needed in order to reset announcement timestamp, so that others cannot front-run agent at
     * confirmUnderlyingWithdrawal call. This could happen if withdrawal would be performed more
     * than confirmationByOthersAfterSeconds seconds after announcement.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     */
    function cancelUnderlyingWithdrawal(
        address _agentVault
    ) external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Terminated asset manager support

    /**
     * When f-asset is terminated, agent can burn the market price of backed f-assets with his collateral,
     * to release the remaining collateral (and, formally, underlying assets).
     * This method ONLY works when f-asset is terminated, which will only be done when AssetManager is already paused
     * at least for a month and most f-assets are already burned and the only ones remaining are unrecoverable.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the agent (cold address) receives the class1 collateral and NAT is burned instead. Therefore
     *      this method is `payable` and the caller must provide enough NAT to cover the received class1 amount
     *      multiplied by `class1BuyForFlareFactorBIPS`.
     */
    function buybackAgentCollateral(
        address _agentVault
    ) external payable;

    ////////////////////////////////////////////////////////////////////////////////////
    // Agent information

    /**
     * Get (a part of) the list of all agents.
     * The list must be retrieved in parts since retrieving the whole list can consume too much gas for one block.
     * @param _start first index to return from the available agent's list
     * @param _end end index (one above last) to return from the available agent's list
     */
    function getAllAgents(uint256 _start, uint256 _end)
        external view
        returns (address[] memory _agentVaults, uint256 _totalLength);

    /**
     * Return detailed info about an agent, typically needed by a minter.
     * @param _agentVault agent vault address
     * @return structure containing agent's minting fee (BIPS), min collateral ratio (BIPS),
     *      and current free collateral (lots)
     */
    function getAgentInfo(address _agentVault)
        external view
        returns (AgentInfo.Info memory);

    /**
     * Returns the collateral pool address of the agent identified by `_agentVault`.
     */
    function getCollateralPool(address _agentVault)
        external view
        returns (address);

    /**
     * Return hot and cold address of the owner of the agent identified by `_agentVault`.
     */
    function getAgentVaultOwner(address _agentVault)
        external view
        returns (address _ownerColdAddress, address _ownerHotAddress);
}
