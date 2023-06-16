// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./SCProofVerifierBase.sol";


contract SCProofVerifierMock is SCProofVerifierBase {

    uint256 public constant BUFFER_WINDOW = 90 seconds;
    uint256 public constant TOTAL_STORED_PROOFS = (1 weeks)/BUFFER_WINDOW;

    bytes32[TOTAL_STORED_PROOFS] public merkleRoots;

    function setMerkleRoot(uint256 _stateConnectorRound, bytes32 _merkleRoot) external {
        merkleRoots[_stateConnectorRound % TOTAL_STORED_PROOFS] = _merkleRoot;
    }

    function merkleRootForRound(uint256 _stateConnectorRound) public view override returns (bytes32 _merkleRoot) {
        return merkleRoots[_stateConnectorRound % TOTAL_STORED_PROOFS];
    }
}
