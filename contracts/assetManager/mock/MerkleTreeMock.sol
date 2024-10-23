// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/MerkleTree.sol";

contract MerkleTreeMock {

    function calculateMerkleRoot(bytes32[] memory _leaves) external pure returns (bytes32) {
        return MerkleTree.calculateMerkleRoot(_leaves);
    }
}
