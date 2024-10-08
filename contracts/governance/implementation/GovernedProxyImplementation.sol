// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { IGovernanceSettings, GovernedBase } from "./GovernedBase.sol";


/**
 * Base class for proxy implementations or diamond facets that expose governed methods -
 * prevents initialization of the implementation/facet as contract (to avoid selfdestruct by attackers).
 *
 * The GovernedBase.initialise can later be called only through a proxy. It should be
 * called through proxy constructor or in diamond cut initializer.
 **/
abstract contract GovernedProxyImplementation is GovernedBase {
    address private constant EMPTY_ADDRESS = 0x0000000000000000000000000000000000001111;

    // Mark as initialised and set governance to an invalid address.
    constructor() {
        initialise(IGovernanceSettings(EMPTY_ADDRESS), EMPTY_ADDRESS);
    }
}
