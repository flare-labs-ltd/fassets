// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../openzeppelin/library/Reentrancy.sol";


library Transfers {
    uint256 internal constant TRANSFER_GAS_ALLOWANCE = 100000;

    /**
     * Transfer the given amount of NAT to recipient without gas limit of `address.transfer()`.
     *
     * **Warning**: ALWAYS guard with nonReentrant, otherwise this is subject to reentrancy vulnerability.
     *
     * **Warning 2**: may fail, so only use when the top-level transaction sender controls recipient address
     * (and therefore expects to fail if there is something strange at that address).
     *
     * @param _recipient the recipient address
     * @param _amount the amount in NAT Wei
     */
    function transferNAT(address payable _recipient, uint256 _amount) internal {
        // make sure the transfer is only called in non-reentrant method
        Reentrancy.requireReentrancyGuard();
        if (_amount > 0) {
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = _recipient.call{value: _amount, gas: TRANSFER_GAS_ALLOWANCE}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, "transfer failed");
        }
    }
}
