// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../stateConnector/interfaces/ISCProofVerifier.sol";


/**
 * Timekeeping for underlying chain.
 */
interface IUnderlyingTimekeeping {
    /**
     * Prove that a block with given number and timestamp exists and
     * update the current underlying block info if the provided data is higher.
     * This method should be called by minters before minting and by agent's regularly
     * to prevent current block being too outdated, which gives too short time for
     * minting or redemption payment.
     * NOTE: anybody can call.
     * @param _proof proof that a block with given number and timestamp exists
     */
    function updateCurrentBlock(
        ConfirmedBlockHeightExists.Proof calldata _proof
    ) external;

    /**
     * Get block number and timestamp of the current underlying block known to the f-asset system.
     * @return _blockNumber current underlying block number tracked by asset manager
     * @return _blockTimestamp current underlying block timestamp tracked by asset manager
     * @return _lastUpdateTs the timestamp on this chain when the current underlying block was last updated
     */
    function currentUnderlyingBlock()
        external view
        returns (uint256 _blockNumber, uint256 _blockTimestamp, uint256 _lastUpdateTs);
}
