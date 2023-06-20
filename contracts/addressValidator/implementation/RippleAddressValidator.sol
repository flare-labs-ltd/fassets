// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../library/BytesLib.sol";
import "../library/Base58.sol";

contract RippleAddressValidator {
    bytes constant XRP_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

    function validate(string memory _rippleAddress)
        external pure
        returns (bool)
    {
        bytes memory rippleAddress = bytes(_rippleAddress);
        if (rippleAddress.length < 25 || rippleAddress.length > 35 || rippleAddress[0] != 'r') {
            return false;
        }
        (bytes memory decoded, bool ok) = Base58.decode(rippleAddress, XRP_ALPHABET);
        return ok ? _checkChecksum(decoded) : false;
    }

    function normalize(string memory _underlyingAddress)
        external pure
        returns (string memory _normalizedAddress, bytes32 _uniqueHash)
    {
        _normalizedAddress = _underlyingAddress;
        _uniqueHash = keccak256(bytes(_normalizedAddress));
    }

    function _checkChecksum(bytes memory _payload)
        private pure
        returns (bool)
    {
        bytes memory checksum = BytesLib.slice(_payload, _payload.length - 4, 4);
        bytes memory accountID = BytesLib.slice(_payload, 0, _payload.length - 4);
        bytes memory accountChecksum = _sha256Checksum(accountID);
        return BytesLib.equal(accountChecksum, checksum);
    }

    function _sha256Checksum(bytes memory _payload)
        private pure
        returns (bytes memory)
    {
        bytes memory dSha256 = abi.encodePacked(sha256(abi.encodePacked(sha256(_payload))));
        return BytesLib.slice(dSha256, 0, 4);
    }

}
