// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v4.9.0) (token/ERC20/extensions/ERC20Permit.sol)

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "../utils/EIP712.sol";

/**
 * @dev Implementation of the ERC20 Permit extension allowing approvals to be made via signatures, as defined in
 * https://eips.ethereum.org/EIPS/eip-2612[EIP-2612].
 *
 * Adds the {permit} method, which can be used to change an account's ERC20 allowance (see {IERC20-allowance}) by
 * presenting a message signed by the account. By not relying on `{IERC20-approve}`, the token holder account doesn't
 * need to send a transaction, and thus is not required to hold Ether at all.
 *
 * @dev Copied from @openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol but updated
 * to be used in upgradable contracts. The original implementation uses EIP712 with immutable variables,
 * which makes it non-upgradable.
 * Moreover, ERC20 is not imported to make sure there are no storage issues. So instead of inherited _approve,
 * an abstract method is used which must be implemented by calling ERC20._approve.
 */
abstract contract ERC20Permit is IERC20Permit, EIP712 {
    using Counters for Counters.Counter;

    struct ERC20PermitState {
        mapping(address => Counters.Counter) nonces;
    }

    bytes32 private constant _PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    // should be implemented by calling ERC20._approve
    function _approve(address owner, address spender, uint256 amount) internal virtual;

    /**
     * @dev See {IERC20Permit-permit}.
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual override {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");

        bytes32 structHash =
            keccak256(abi.encode(_PERMIT_TYPEHASH, owner, spender, value, _useNonce(owner), deadline));

        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSA.recover(hash, v, r, s);
        require(signer == owner, "ERC20Permit: invalid signature");

        _approve(owner, spender, value);
    }

    /**
     * @dev See {IERC20Permit-nonces}.
     */
    function nonces(address owner) public view virtual override returns (uint256) {
        return _getERC20PermitState().nonces[owner].current();
    }

    /**
     * @dev See {IERC20Permit-DOMAIN_SEPARATOR}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view override returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @dev "Consume a nonce": return the current value and increment.
     *
     * _Available since v4.1._
     */
    function _useNonce(address owner) internal virtual returns (uint256 current) {
        Counters.Counter storage nonce = _getERC20PermitState().nonces[owner];
        current = nonce.current();
        nonce.increment();
    }

    // keccak256(abi.encode(uint256(keccak256("fasset.openzeppelin.ERC20Permit")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant _STORAGE_LOCATION = 0x361beb44631d074062265988ad0b416453c05cfc27148633e5eff4da54187b00;

    function _getERC20PermitState()
        private pure
        returns (ERC20PermitState storage _state)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _state.slot := _STORAGE_LOCATION
        }
    }
}
