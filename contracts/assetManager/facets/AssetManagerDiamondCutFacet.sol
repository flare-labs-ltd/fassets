// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/******************************************************************************\
* Author: Nick Mudge <nick@perfectabstractions.com> (https://twitter.com/mudgen)
* EIP-2535 Diamonds: https://eips.ethereum.org/EIPS/eip-2535
/******************************************************************************/

import { IDiamondCut } from "../../diamond/interfaces/IDiamondCut.sol";
import { LibDiamond } from "../../diamond/library/LibDiamond.sol";
import { GovernedProxyImplementation } from "../../governance/implementation/GovernedProxyImplementation.sol";
import { Globals } from "../library/Globals.sol";

// DiamondCutFacet that also respects diamondCutMinTimelockSeconds setting.

// Remember to add the loupe functions from DiamondLoupeFacet to the diamond.
// The loupe functions are required by the EIP2535 Diamonds standard

contract AssetManagerDiamondCutFacet is IDiamondCut, GovernedProxyImplementation {
    /// @notice Add/replace/remove any number of functions and optionally execute
    ///         a function with delegatecall
    /// @param _diamondCut Contains the facet addresses and function selectors
    /// @param _init The address of the contract or facet to execute _calldata
    /// @param _calldata A function call, including function selector and arguments
    ///                  _calldata is executed with delegatecall on _init
    function diamondCut(
        FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    )
        external override
        onlyGovernanceWithTimelockAtLeast(Globals.getSettings().diamondCutMinTimelockSeconds)
    {
        LibDiamond.diamondCut(_diamondCut, _init, _calldata);
    }
}
