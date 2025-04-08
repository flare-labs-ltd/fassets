// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract EIP712DomainMock is EIP712 {
    constructor(string memory name, string memory version)
        EIP712(name, version)
    {
    }

    function domainSeparatorV4() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function hashTypedDataV4(bytes32 structHash) external view virtual returns (bytes32) {
        return _hashTypedDataV4(structHash);
    }

    function verify(bytes memory signature, address signer, address mailTo, string memory mailContents) external view {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(keccak256("Mail(address to,string contents)"), mailTo, keccak256(bytes(mailContents)))
            )
        );
        address recoveredSigner = ECDSA.recover(digest, signature);
        require(recoveredSigner == signer);
    }
}
