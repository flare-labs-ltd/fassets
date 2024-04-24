// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import { IGovernanceSettings, GovernedBase } from "../../governance/implementation/GovernedBase.sol";


/**
 * Base class for diamond facets that expose governed methods - prevents initialization of
 * the facet as contract (to avoid selfdestruct by attackers).
 * The GovernedBase.initialise can later be called only through a proxy.
 **/
abstract contract GovernedFacet is GovernedBase {
    address private constant EMPTY_ADDRESS = 0x0000000000000000000000000000000000001111;

    // Mark as initialised and set governance to an invalid address.
    constructor() {
        initialise(IGovernanceSettings(EMPTY_ADDRESS), EMPTY_ADDRESS);
    }
}
