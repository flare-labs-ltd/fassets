// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import {Governed} from "../implementation/Governed.sol";


/**
 * @title Governed mock contract
 * @notice A contract to expose the Governed contract for unit testing.
 **/
contract GovernedMock is Governed {
    
        constructor(address _governance) Governed(_governance) {
        require(_governance != address(0), "_governance zero");
    }
    
}