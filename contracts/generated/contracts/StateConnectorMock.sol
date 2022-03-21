// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

contract StateConnectorMock {

    uint256 public constant BUFFER_WINDOW = 90 seconds; 
    uint256 public constant TOTAL_STORED_PROOFS = (1 weeks)/BUFFER_WINDOW; 

    bytes32[TOTAL_STORED_PROOFS] public merkleRoots; 

    function setMerkleRoot(uint256 _stateConnectorRound, bytes32 _merkleRoot) external {
        merkleRoots[_stateConnectorRound % TOTAL_STORED_PROOFS] = _merkleRoot;
    }
}