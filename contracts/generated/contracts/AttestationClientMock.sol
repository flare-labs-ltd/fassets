// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./AttestationClientBase.sol";

contract AttestationClientMock is AttestationClientBase {
    mapping (uint256 => bytes32) private _merkleRoots;

    function setMerkleRootForStateConnectorRound(
        bytes32 _merkleRoot,
        uint256 _stateConnectorRound
    ) external {
        _merkleRoots[_stateConnectorRound] = _merkleRoot;
    }

    function merkleRootForRound(uint256 _stateConnectorRound) public view override returns (bytes32 _merkleRoot) {
        return _merkleRoots[_stateConnectorRound];
    }
}
