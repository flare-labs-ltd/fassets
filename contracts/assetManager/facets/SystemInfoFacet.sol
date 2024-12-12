// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/data/AssetManagerState.sol";
import "../library/Globals.sol";
import "../library/RedemptionQueueInfo.sol";
import "./AssetManagerBase.sol";


contract SystemInfoFacet is AssetManagerBase {
    /**
     * When `controllerAttached` is true, asset manager has been added to the asset manager controller.
     */
    function controllerAttached() external view  returns (bool) {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.attached;
    }

    /**
     * True if asset manager is paused.
     */
    function mintingPaused()
        external view
        returns (bool)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.mintingPausedAt != 0;
    }

    /**
     * True if asset manager is terminated.
     */
    function terminated()
        external view
        returns (bool)
    {
        return Globals.getFAsset().terminated();
    }

    /**
     * Return (part of) the redemption queue.
     * @param _firstRedemptionTicketId the ticket id to start listing from; if 0, starts from the beginning
     * @param _pageSize the maximum number of redemption tickets to return
     * @return _queue the (part of) the redemption queue; maximum length is _pageSize
     * @return _nextRedemptionTicketId works as a cursor - if the _pageSize is reached and there are more tickets,
     *  it is the first ticket id not returned; if the end is reached, it is 0
     */
    function redemptionQueue(
        uint256 _firstRedemptionTicketId,
        uint256 _pageSize
    )
        external view
        returns (RedemptionTicketInfo.Data[] memory _queue, uint256 _nextRedemptionTicketId)
    {
        return RedemptionQueueInfo.redemptionQueue(_firstRedemptionTicketId, _pageSize);
    }

    /**
     * Return (part of) the redemption queue for a specific agent.
     * @param _agentVault the agent vault address of the queried agent
     * @param _firstRedemptionTicketId the ticket id to start listing from; if 0, starts from the beginning
     * @param _pageSize the maximum number of redemption tickets to return
     * @return _queue the (part of) the redemption queue; maximum length is _pageSize
     * @return _nextRedemptionTicketId works as a cursor - if the _pageSize is reached and there are more tickets,
     *  it is the first ticket id not returned; if the end is reached, it is 0
     */
    function agentRedemptionQueue(
        address _agentVault,
        uint256 _firstRedemptionTicketId,
        uint256 _pageSize
    )
        external view
        returns (RedemptionTicketInfo.Data[] memory _queue, uint256 _nextRedemptionTicketId)
    {
        return RedemptionQueueInfo.agentRedemptionQueue(_agentVault, _firstRedemptionTicketId, _pageSize);
    }
}
