// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./AssetManagerState.sol";
import "./TransactionAttestation.sol";


library StateUpdater {
    function updateCurrentBlock(
        AssetManagerState.State storage _state,
        IAttestationClient.ConfirmedBlockHeightExists calldata _proof
    )
        external
    {
        TransactionAttestation.verifyConfirmedBlockHeightExists(_state.settings, _proof);
        bool changed = false;
        if (_proof.blockNumber > _state.currentUnderlyingBlock) {
            _state.currentUnderlyingBlock = _proof.blockNumber;
            changed = true;
        }
        if (_proof.blockTimestamp > _state.currentUnderlyingBlockTimestamp) {
            _state.currentUnderlyingBlockTimestamp = _proof.blockTimestamp;
            changed = true;
        }
        if (changed) {
            _state.currentUnderlyingBlockUpdatedAt = SafeCast.toUint64(block.timestamp);
        }
    }
}
