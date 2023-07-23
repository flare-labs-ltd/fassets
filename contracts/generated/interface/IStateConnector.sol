// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

// solhint-disable func-name-mixedcase
interface IStateConnector {
    event AttestationRequest(
        address sender,
        uint256 timestamp,
        bytes data
    );

    event RoundFinalised(
        uint256 indexed roundId,
        bytes32 merkleRoot
    );

    /**
     * The method to call for requesting a new attestation.
     * Emits event `AttestationRequest`, which triggers work by attestation providers.
     */
    function requestAttestations(bytes calldata _data) external;

    /**
     * Last finalized round id.
     */
    function lastFinalizedRoundId() external view returns (uint256 _roundId);

    /**
     * Get Merkle root for the round and check for buffer overflows.
     */
    function merkleRoot(uint256 _roundId) external view returns (bytes32);

    /**
     * The first buffer timestamp
     * (start time in seconds for converting the timestamp into a round number).
     */
    function BUFFER_TIMESTAMP_OFFSET() external view returns (uint256);

    /**
     * Amount of time a buffer is active before cycling to the next one
     * (round length in seconds for converting the timestamp into a round number).
     */
    function BUFFER_WINDOW() external view returns (uint256);
}
