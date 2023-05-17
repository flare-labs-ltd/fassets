// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "flare-smart-contracts/contracts/addressUpdater/interface/IIAddressUpdatable.sol";


abstract contract AddressUpdatable is IIAddressUpdatable {

    // https://docs.soliditylang.org/en/v0.8.7/contracts.html#constant-and-immutable-state-variables
    // No storage slot is allocated
    bytes32 internal constant ADDRESS_STORAGE_POSITION =
        keccak256("flare.diamond.AddressUpdatable.ADDRESS_STORAGE_POSITION");

    modifier onlyAddressUpdater() {
        require (msg.sender == getAddressUpdater(), "only address updater");
        _;
    }

    constructor(address _addressUpdater) {
        setAddressUpdaterValue(_addressUpdater);
    }

    function getAddressUpdater() public view returns (address _addressUpdater) {
        // Only direct constants are allowed in inline assembly, so we assign it here
        bytes32 position = ADDRESS_STORAGE_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _addressUpdater := sload(position)
        }
    }

    /**
     * @notice external method called from AddressUpdater only
     */
    function updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        external override
        onlyAddressUpdater
    {
        // update addressUpdater address
        setAddressUpdaterValue(_getContractAddress(_contractNameHashes, _contractAddresses, "AddressUpdater"));
        // update all other addresses
        _updateContractAddresses(_contractNameHashes, _contractAddresses);
    }

    /**
     * @notice virtual method that a contract extending AddressUpdatable must implement
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    ) internal virtual;

    /**
     * @notice helper method to get contract address
     * @dev it reverts if contract name does not exist
     */
    function _getContractAddress(
        bytes32[] memory _nameHashes,
        address[] memory _addresses,
        string memory _nameToFind
    )
        internal pure
        returns(address)
    {
        bytes32 nameHash = keccak256(abi.encode(_nameToFind));
        address a = address(0);
        for (uint256 i = 0; i < _nameHashes.length; i++) {
            if (nameHash == _nameHashes[i]) {
                a = _addresses[i];
                break;
            }
        }
        require(a != address(0), "address zero");
        return a;
    }

    function setAddressUpdaterValue(address _addressUpdater) internal {
        // Only direct constants are allowed in inline assembly, so we assign it here
        bytes32 position = ADDRESS_STORAGE_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(position, _addressUpdater)
        }
    }
}
