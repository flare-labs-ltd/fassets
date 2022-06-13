// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./AttestationClientBase.sol";
import "../interface/IStateConnector.sol";

contract AttestationClientSC is AttestationClientBase {
    IStateConnector public stateConnector;

    constructor(IStateConnector _stateConnector) {
        stateConnector = _stateConnector;
    }

    function merkleRootForRound(uint256 _stateConnectorRound) public view override returns (bytes32 _merkleRoot) {
        return stateConnector.merkleRoots(_stateConnectorRound % stateConnector.TOTAL_STORED_PROOFS());
    }
}
