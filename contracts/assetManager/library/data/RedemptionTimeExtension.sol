// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../../utils/lib/SafeMath64.sol";


library RedemptionTimeExtension {
    using SafeCast for uint256;
    using SafeMath64 for uint64;

    struct AgentTimeExtensionData {
        uint64 extendedTimestamp;
    }

    struct State {
        // settings
        uint64 redemptionPaymentExtensionSeconds;

        // per agent state
        mapping(address _agentVault => AgentTimeExtensionData) agents;
    }

    /**
     * Calculates the redemption time extension when there are multiple redemption requests in short time.
     * Implements "leaky bucket" algorithm, popular in rate-limiters.
     * @param _agentVault the agent vault address being redeemed
     */
    function extendTimeForRedemption(address _agentVault)
        internal
        returns (uint64)
    {
        State storage state = getState();
        AgentTimeExtensionData storage agentData = state.agents[_agentVault];
        uint64 timestamp = block.timestamp.toUint64();
        uint64 accumulatedTimestamp = agentData.extendedTimestamp + state.redemptionPaymentExtensionSeconds;
        agentData.extendedTimestamp = SafeMath64.max64(accumulatedTimestamp, timestamp);
        return agentData.extendedTimestamp - timestamp;
    }

    function setRedemptionPaymentExtensionSeconds(uint256 _value)
        internal
    {
        State storage state = getState();
        state.redemptionPaymentExtensionSeconds = _value.toUint64();
    }

    function redemptionPaymentExtensionSeconds()
        internal view
        returns (uint256)
    {
        State storage state = getState();
        return state.redemptionPaymentExtensionSeconds;
    }

    function getState()
        internal pure
        returns (State storage _state)
    {
        bytes32 position = keccak256("fasset.RedemptionTimeExtension.State");
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _state.slot := position
        }
    }
}
