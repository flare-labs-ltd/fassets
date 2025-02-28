// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../library/AgentsExternal.sol";
import "../library/RedemptionRequests.sol";
import "./AssetManagerBase.sol";


contract RedemptionHandshakeFacet is AssetManagerBase, ReentrancyGuard {
    using SafeCast for uint256;

    /**
     * In case the agent requires handshake, the redemption request can be rejected by the agent.
     * Any other agent can take over the redemption request.
     * If no agent takes over the redemption, the redeemer can request the default payment.
     * NOTE: may only be called by the owner of the agent vault in the redemption request
     * @param _redemptionRequestId id of an existing redemption request
     */
    function rejectRedemptionRequest(
        uint256 _redemptionRequestId
    )
        external
        nonReentrant
    {
        RedemptionRequests.rejectRedemptionRequest(_redemptionRequestId.toUint64());
    }

    /**
     * The agent can take over the rejected redemption request - it cannot be rejected again.
     * NOTE: may only be called by the owner of the agent vault
     * @param _agentVault agent vault address
     * @param _redemptionRequestId id of an existing redemption request
     */
    function takeOverRedemptionRequest(
        address _agentVault,
        uint256 _redemptionRequestId
    )
        external
        notEmergencyPaused
        nonReentrant
    {
        RedemptionRequests.takeOverRedemptionRequest(_agentVault, _redemptionRequestId.toUint64());
    }
}
