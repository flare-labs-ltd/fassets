// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./data/AssetManagerState.sol";
import "./Conversion.sol";
import "./Agents.sol";


library RedemptionQueueInfo {
    using SafeCast for uint256;

    function redemptionQueue(uint256 _firstRedemptionTicketId, uint256 _pageSize)
        internal view
        returns (RedemptionTicketInfo.Data[] memory _queue, uint256 _nextRedemptionTicketId)
    {
        return _getRedemptionQueue(address(0), _firstRedemptionTicketId, _pageSize);
    }

    function agentRedemptionQueue(address _agentVault, uint256 _firstRedemptionTicketId, uint256 _pageSize)
        internal view
        returns (RedemptionTicketInfo.Data[] memory _queue, uint256 _nextRedemptionTicketId)
    {
        // check that _agentVault address is valid
        Agent.get(_agentVault);
        return _getRedemptionQueue(_agentVault, _firstRedemptionTicketId, _pageSize);
    }

    function _getRedemptionQueue(address _agentVault, uint256 _firstRedemptionTicketId, uint256 _pageSize)
        private view
        returns (RedemptionTicketInfo.Data[] memory _queue, uint256 _nextRedemptionTicketId)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        RedemptionQueue.State storage queue = state.redemptionQueue;
        uint64 ticketId = _firstRedemptionTicketId.toUint64();
        if (ticketId == 0) {
            // start from beginning
            ticketId = _agentVault == address(0) ? queue.firstTicketId : queue.agents[_agentVault].firstTicketId;
        }
        require (ticketId == 0 || queue.tickets[ticketId].agentVault != address(0), "invalid ticket id");
        RedemptionTicketInfo.Data[] memory result = new RedemptionTicketInfo.Data[](_pageSize);
        uint256 count = 0;
        while (ticketId != 0 && count < _pageSize) {
            RedemptionQueue.Ticket storage ticket = queue.tickets[ticketId];
            result[count] = RedemptionTicketInfo.Data({
                agentVault: ticket.agentVault,
                redemptionTicketId: ticketId,
                ticketValueUBA: Conversion.convertAmgToUBA(ticket.valueAMG)
            });
            ticketId = _agentVault == address(0) ? ticket.next : ticket.nextForAgent;
            ++count;
        }
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // truncate result array
            mstore(result, count)
        }
        return (result, ticketId);
    }
}
