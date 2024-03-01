// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import { LibDiamond } from "../library/LibDiamond.sol";
import { IDiamondCut } from "../interfaces/IDiamondCut.sol";
import { Diamond } from "../implementation/Diamond.sol";


contract MockDiamond is Diamond {
    constructor(IDiamondCut.FacetCut[] memory _diamondCut, address _init, bytes memory _initCalldata) payable {
        LibDiamond.diamondCut(_diamondCut, _init, _initCalldata);
        // Code can be added here to perform actions and set state variables.
    }

    function testFunc() external {}
}
