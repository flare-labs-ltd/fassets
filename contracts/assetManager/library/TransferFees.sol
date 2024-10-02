// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "./data/TransferFeeTracking.sol";


library TransferFees {
    struct State {
        // SETTINGS

        // The fee paid for FAsset transfers.
        // Unlike other ratios that are in BIPS, this one is in millionths (1/1000000), which is 1/100 of a BIP.
        // This is because the values can be very small, just a few BIPS.
        uint32 transferFeeMillionths;

        // STATE
        // transfer fee and minting tracking
        TransferFeeTracking.Data transferFeeTracking;
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
