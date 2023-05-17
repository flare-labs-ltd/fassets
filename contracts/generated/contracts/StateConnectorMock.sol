// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../interface/IStateConnector.sol";

contract StateConnectorMock is IStateConnector {
    uint256 public constant BUFFER_WINDOW = 90 seconds;
    uint256 public constant TOTAL_STORED_PROOFS = (1 weeks)/BUFFER_WINDOW;
    uint256 public constant BUFFER_TIMESTAMP_OFFSET = 1636070400 seconds;

    bytes32[TOTAL_STORED_PROOFS] public merkleRoots;
    uint256 public lastFinalizedRoundId = 0;

    function setMerkleRoot(uint256 _stateConnectorRound, bytes32 _merkleRoot) external {
        merkleRoots[_stateConnectorRound % TOTAL_STORED_PROOFS] = _merkleRoot;
        lastFinalizedRoundId = _stateConnectorRound;
        emit RoundFinalised(_stateConnectorRound, _merkleRoot);
    }

    function requestAttestations(bytes calldata _data) external {
        emit AttestationRequest(msg.sender, block.timestamp, _data);
    }

    function merkleRoot(uint256 _roundId) external view returns (bytes32) {
        return merkleRoots[_roundId % TOTAL_STORED_PROOFS];
    }
}
