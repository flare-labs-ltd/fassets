// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import { GovernedBase } from "./GovernedBase.sol";


/**
 * @title Governed
 * @dev For deployed, governed contracts, enforce a non-zero address at create time.
 **/
contract Governed is GovernedBase {
    constructor(address _governance) GovernedBase(_governance) {
        require(_governance != address(0), "_governance zero");
    }
}
