// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "../interface/IAddressValidator.sol";


contract TrivialAddressValidatorMock is IAddressValidator {
    function validate(string memory /*_underlyingAddress*/)
        external pure override
        returns (bool)
    {
        return true;
    }

    function normalize(string memory _underlyingAddress)
        external pure override
        returns (string memory _normalizedAddress, bytes32 _uniqueHash)
    {
        _normalizedAddress = _underlyingAddress;
        _uniqueHash = keccak256(bytes(_normalizedAddress));
    }
}
