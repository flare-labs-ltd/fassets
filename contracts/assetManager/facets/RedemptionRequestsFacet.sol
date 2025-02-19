// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../library/AgentsExternal.sol";
import "../library/RedemptionRequests.sol";
import "./AssetManagerBase.sol";


contract RedemptionRequestsFacet is AssetManagerBase, ReentrancyGuard {
    using SafeCast for uint256;

    /**
     * Redeem (up to) `_lots` lots of f-assets. The corresponding amount of the f-assets belonging
     * to the redeemer will be burned and the redeemer will get paid by the agent in underlying currency
     * (or, in case of agent's payment default, by agent's collateral with a premium).
     * NOTE: in some cases not all sent f-assets can be redeemed (either there are not enough tickets or
     * more than a fixed limit of tickets should be redeemed). In this case only part of the approved assets
     * are burned and redeemed and the redeemer can execute this method again for the remaining lots.
     * In such case `RedemptionRequestIncomplete` event will be emitted, indicating the number of remaining lots.
     * Agent receives redemption request id and instructions for underlying payment in
     * RedemptionRequested event and has to pay `value - fee` and use the provided payment reference.
     * The agent can also reject the redemption request. In that case any other agent can take over the redemption.
     * If no agent takes over the redemption, the redeemer can request the default payment.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _lots number of lots to redeem
     * @param _redeemerUnderlyingAddressString the address to which the agent must transfer underlying amount
     * @param _executor the account that is allowed to execute redemption default (besides redeemer and agent)
     * @return _redeemedAmountUBA the actual redeemed amount; may be less than requested if there are not enough
     *      redemption tickets available or the maximum redemption ticket limit is reached
     */
    function redeem(
        uint256 _lots,
        string memory _redeemerUnderlyingAddressString,
        address payable _executor
    )
        external payable
        onlyWhitelistedSender
        notEmergencyPaused
        returns (uint256 _redeemedAmountUBA)
    {
        return RedemptionRequests.redeem(msg.sender, _lots.toUint64(), _redeemerUnderlyingAddressString, _executor);
    }

    /**
     * Create a redemption from a single agent. Used in self-close exit from the collateral pool.
     * Note: only collateral pool can call this method.
     */
    function redeemFromAgent(
        address _agentVault,
        address _receiver,
        uint256 _amountUBA,
        string memory _receiverUnderlyingAddress,
        address payable _executor
    )
        external payable
        notEmergencyPaused
    {
        RedemptionRequests.redeemFromAgent(_agentVault, _receiver, _amountUBA, _receiverUnderlyingAddress, _executor);
    }

    /**
     * Burn fassets from  a single agent and get paid in vault collateral by the agent.
     * Price is FTSO price, multiplied by factor buyFAssetByAgentFactorBIPS (set by agent).
     * Used in self-close exit from the collateral pool when requested or when self-close amount is less than 1 lot.
     * Note: only collateral pool can call this method.
     */
    function redeemFromAgentInCollateral(
        address _agentVault,
        address _receiver,
        uint256 _amountUBA
    )
        external
        notEmergencyPaused
    {
        RedemptionRequests.redeemFromAgentInCollateral(_agentVault, _receiver, _amountUBA);
    }

    /**
     * To avoid unlimited work, the maximum number of redemption tickets closed in redemption, self close
     * or liquidation is limited. This means that a single redemption/self close/liquidation is limited.
     * This function calculates the maximum single redemption amount.
     */
    function maxRedemptionFromAgent(
        address _agentVault
    )
        external view
        returns (uint256)
    {
        return RedemptionRequests.maxRedemptionFromAgent(_agentVault);
    }

    /**
     * If the redeemer provides invalid address, the agent should provide the proof of address invalidity from the
     * Flare data connector. With this, the agent's obligations are fulfilled and they can keep the underlying.
     * NOTE: may only be called by the owner of the agent vault in the redemption request
     * NOTE: also checks that redeemer's address is normalized, so the redeemer must normalize their address,
     *   otherwise it will be rejected!
     * @param _proof proof that the address is invalid
     * @param _redemptionRequestId id of an existing redemption request
     */
    function rejectInvalidRedemption(
        IAddressValidity.Proof calldata _proof,
        uint256 _redemptionRequestId
    )
        external
    {
        RedemptionRequests.rejectInvalidRedemption(_proof, _redemptionRequestId.toUint64());
    }

    /**
     * Agent can "redeem against himself" by calling selfClose, which burns agent's own f-assets
     * and unlocks agent's collateral. The underlying funds backing the f-assets are released
     * as agent's free underlying funds and can be later withdrawn after announcement.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _amountUBA amount of f-assets to self-close
     * @return _closedAmountUBA the actual self-closed amount, may be less than requested if there are not enough
     *      redemption tickets available or the maximum redemption ticket limit is reached
     */
    function selfClose(
        address _agentVault,
        uint256 _amountUBA
    )
        external
        notEmergencyPaused
        returns (uint256 _closedAmountUBA)
    {
        // in SelfClose.selfClose we check that only agent can do this
        return RedemptionRequests.selfClose(_agentVault, _amountUBA);
    }

    /**
     * After a lot size change by the governance, it may happen that after a redemption
     * there remains less than one lot on a redemption ticket. This is named "dust" and
     * can be self closed or liquidated, but not redeemed. However, after several such redemptions,
     * the total dust can amount to more than one lot. Using this method, the amount, rounded down
     * to a whole number of lots, can be converted to a new redemption ticket.
     * NOTE: we do NOT check that the caller is the agent vault owner, since we want to
     * allow anyone to convert dust to tickets to increase asset fungibility.
     * @param _agentVault agent vault address
     */
    function convertDustToTicket(
        address _agentVault
    )
        external
    {
        AgentsExternal.convertDustToTicket(_agentVault);
    }
}
