// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../openzeppelin/library/Reentrancy.sol";


library Transfers {
    uint256 internal constant TRANSFER_GAS_ALLOWANCE = 100_000;

    // make sure the transfer is only called in non-reentrant method
    modifier requireReentrancyGuard {
        Reentrancy.requireReentrancyGuard();
        _;
    }

    /**
     * Transfer the given amount of NAT to recipient without gas limit of `address.transfer()`.
     *
     * **Warning**: Must guard with nonReentrant, otherwise the method will fail.
     *
     * **Warning 2**: may fail, so only use when the top-level transaction sender controls recipient address
     * (and therefore expects to fail if there is something strange at that address).
     *
     * @param _recipient the recipient address
     * @param _amount the amount in NAT Wei
     */
    function transferNAT(address payable _recipient, uint256 _amount)
        internal
        requireReentrancyGuard
    {
        if (_amount > 0) {
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = _recipient.call{value: _amount, gas: TRANSFER_GAS_ALLOWANCE}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, "transfer failed");
        }
    }

    /**
     * Transfer the given amount of NAT to recipient without gas limit of `address.transfer()`.
     * Never fails, instead it returns the success status.
     *
     * **Warning**: Must guard with nonReentrant, otherwise the method will fail.
     *
     * @param _recipient the recipient address
     * @param _amount the amount in NAT Wei
     */
    function transferNATAllowFailure(address payable _recipient, uint256 _amount)
        internal
        requireReentrancyGuard
        returns (bool)
    {
        if (_amount > 0) {
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = _recipient.call{value: _amount, gas: TRANSFER_GAS_ALLOWANCE}("");
            /* solhint-enable avoid-low-level-calls */
            return success;
        }
        return true;
    }
}
