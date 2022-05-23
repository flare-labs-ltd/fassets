
// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../implementation/AddressUpdatable.sol";


contract AddressUpdatableMock is AddressUpdatable {

    bytes32[] public contractNameHashes;
    address[] public contractAddresses;

    constructor(address _addressUpdater) AddressUpdatable(_addressUpdater) {

    }

    function getContractNameHashesAndAddresses() external view
        returns(
            bytes32[] memory _contractNameHashes,
            address[] memory _contractAddresses
        )
    {
        return (contractNameHashes, contractAddresses);
    }
    
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    ) 
        internal override
    {
        contractNameHashes = _contractNameHashes;
        contractAddresses = _contractAddresses;
    }
}
