// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/MerkleTree.sol";

contract MerkleTreeMock {

    function calculateMerkleRoot(bytes32[] memory _leaves) external pure returns (bytes32) {
        return MerkleTree.calculateMerkleRoot(_leaves);
    }

    function doubleHash(string memory _str) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(keccak256(bytes(_str))));
    }
}
