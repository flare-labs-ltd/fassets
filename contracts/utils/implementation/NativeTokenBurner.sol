// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;


/**
 * @notice This contract works around an issue in the validator that will not accept transfers
 *         to the burn address. Instead, this contract self-destructs tokens to that address.
 */
contract NativeTokenBurner {
    address payable public burnAddress;

    event Received(uint256 amountWei);
    event Burned(address payable burnAddress, uint256 burnedWei);

    constructor(
        address payable _burnAddress
    )
    {
        burnAddress = _burnAddress;
    }

    receive() external payable {
        emit Received(msg.value);
    }

    // easier to call from code than transfering
    function transfer() external payable {
        emit Received(msg.value);
    }

    //slither-disable-next-line suicidal
    function die() external {
        emit Burned(burnAddress, address(this).balance);
        selfdestruct(burnAddress);
    }
}
