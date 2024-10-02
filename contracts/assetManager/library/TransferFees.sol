// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./data/TransferFeeTracking.sol";


library TransferFees {
    using SafeCast for *;

    struct State {
        // SETTINGS

        // The fee paid for FAsset transfers.
        // Unlike other ratios that are in BIPS, this one is in millionths (1/1000000), which is 1/100 of a BIP.
        // This is because the values can be very small, just a few BIPS.
        uint32 transferFeeMillionths;

        // Allow transfer fee change to be scheduled. For example, this is useful if we want the fee change to
        // take affect at the beginning of a claim epoch.
        uint32 nextTransferFeeMillionths;
        uint64 nextTransferFeeMillionthsScheduledAt;

        // STATE
        // transfer fee and minting tracking
        TransferFeeTracking.Data transferFeeTracking;
    }

    function transferFeeMillionths() internal view returns (uint32) {
        State storage state = getState();
        uint256 nextValueScheduledAt = state.nextTransferFeeMillionthsScheduledAt;
        bool nextValueActive = nextValueScheduledAt != 0 && nextValueScheduledAt <= block.timestamp;
        return nextValueActive ? state.nextTransferFeeMillionths : state.transferFeeMillionths;
    }

    function updateTransferFeeMillionths(uint256 _value, uint256 _scheduledAt) internal {
        State storage state = getState();
        if (_scheduledAt > block.timestamp) {
            // flush previous update
            state.transferFeeMillionths = transferFeeMillionths();
            // schedule new
            state.nextTransferFeeMillionths = _value.toUint32();
            state.nextTransferFeeMillionthsScheduledAt = _scheduledAt.toUint32();
        } else {
            // update immediately
            state.transferFeeMillionths = _value.toUint32();
            state.nextTransferFeeMillionths = 0;
            state.nextTransferFeeMillionthsScheduledAt = 0;
        }
    }

    function updateMintingHistory(address _agentVault, uint64 _amountAMG) internal {
        State storage state = getState();
        TransferFeeTracking.updateMintingHistory(state.transferFeeTracking, _agentVault, _amountAMG);
    }

    bytes32 internal constant STATE_POSITION = keccak256("fasset.TransferFees.State");

    function getState()
        internal pure
        returns (State storage _state)
    {
        bytes32 position = STATE_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _state.slot := position
        }
    }
}
