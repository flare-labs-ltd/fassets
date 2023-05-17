// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../implementation/Governed.sol";


/**
 * @title Governed mock contract
 * @notice A contract to expose the Governed contract for unit testing.
 **/
contract GovernedMock is Governed {

    constructor(IGovernanceSettings _governanceSettings, address _initialGovernance)
        Governed(_governanceSettings, _initialGovernance)
    {
        /* empty block */
    }
}
