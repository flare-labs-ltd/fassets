// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../diamond/implementation/Diamond.sol";
import "../../diamond/library/LibDiamond.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";

/**
 * The contract that can mint and burn f-assets while managing collateral and backing funds.
 * There is one instance of AssetManager per f-asset type.
 */
contract AssetManager is Diamond, IAssetManagerEvents {
    // IAssetManagerEvents interface is included so that blockchain explorers will be able
    // to decode events for verified AssetManager instances.
    constructor(IDiamondCut.FacetCut[] memory _diamondCut, address _init, bytes memory _initCalldata) payable {
        LibDiamond.diamondCut(_diamondCut, _init, _initCalldata);
    }
}
