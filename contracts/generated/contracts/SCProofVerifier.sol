// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./SCProofVerifierBase.sol";
import "../interface/IStateConnector.sol";

contract SCProofVerifier is SCProofVerifierBase {
    IStateConnector public stateConnector;

    constructor(IStateConnector _stateConnector) {
        stateConnector = _stateConnector;
    }

    function merkleRootForRound(uint256 _stateConnectorRound) public view override returns (bytes32 _merkleRoot) {
        return stateConnector.merkleRoot(_stateConnectorRound);
    }
}
