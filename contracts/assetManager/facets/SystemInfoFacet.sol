// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../library/data/AssetManagerState.sol";
import "../library/Globals.sol";
import "../library/RedemptionQueueInfo.sol";
import "../library/Redemptions.sol";
import "../library/CollateralReservations.sol";
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

    function collateralReservationInfo(
        uint256 _collateralReservationId
    )
        external view
        returns (CollateralReservationInfo.Data memory)
    {
        uint64 crtId = SafeCast.toUint64(_collateralReservationId);
        CollateralReservation.Data storage crt = CollateralReservations.getCollateralReservation(crtId);
        Agent.State storage agent = Agent.get(crt.agentVault);
        return CollateralReservationInfo.Data({
            collateralReservationId: crtId,
            agentVault: crt.agentVault,
            minter: crt.minter,
            paymentAddress: agent.underlyingAddressString,
            paymentReference: PaymentReference.minting(crtId),
            valueUBA: Conversion.convertAmgToUBA(crt.valueAMG),
            mintingFeeUBA: crt.underlyingFeeUBA,
            reservationFeeNatWei: crt.reservationFeeNatWei,
            poolFeeShareBIPS: crt.poolFeeShareBIPS,
            firstUnderlyingBlock: crt.firstUnderlyingBlock,
            lastUnderlyingBlock: crt.lastUnderlyingBlock,
            lastUnderlyingTimestamp: crt.lastUnderlyingTimestamp,
            executor: crt.executor,
            executorFeeNatWei: crt.executorFeeNatGWei * Conversion.GWEI,
            handshakeStartTimestamp: crt.handshakeStartTimestamp,
            sourceAddressesRoot: crt.sourceAddressesRoot
        });
    }

    function redemptionRequestInfo(
        uint256 _redemptionRequestId
    )
        external view
        returns (RedemptionRequestInfo.Data memory)
    {
        uint64 requestId = SafeCast.toUint64(_redemptionRequestId);
        Redemption.Request storage request = Redemptions.getRedemptionRequest(requestId);
        RedemptionRequestInfo.Status status = request.status == Redemption.Status.ACTIVE ?
                RedemptionRequestInfo.Status.ACTIVE : RedemptionRequestInfo.Status.DEFAULTED;
        return RedemptionRequestInfo.Data({
            redemptionRequestId: requestId,
            status: status,
            agentVault: request.agentVault,
            redeemer: request.redeemer,
            paymentAddress: request.redeemerUnderlyingAddressString,
            paymentReference: PaymentReference.redemption(requestId),
            valueUBA: request.underlyingValueUBA,
            feeUBA: request.underlyingFeeUBA,
            poolFeeShareBIPS: request.poolFeeShareBIPS,
            firstUnderlyingBlock: request.firstUnderlyingBlock,
            lastUnderlyingBlock: request.lastUnderlyingBlock,
            lastUnderlyingTimestamp: request.lastUnderlyingTimestamp,
            timestamp: request.timestamp,
            poolSelfClose: request.poolSelfClose,
            transferToCoreVault: request.transferToCoreVault,
            executor: request.executor,
            executorFeeNatWei: request.executorFeeNatGWei * Conversion.GWEI,
            rejectionTimestamp: request.rejectionTimestamp,
            takeOverTimestamp: request.takeOverTimestamp
        });
    }
}
