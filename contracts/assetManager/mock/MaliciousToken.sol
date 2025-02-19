// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;


contract MaliciousToken {

    address public owner;

    constructor() {
        owner = msg.sender;
    }
    function balanceOf(address) public pure returns (uint256) {
        return 1;
    }

    function deposit() public payable  returns (bool) {
        payable(owner).transfer(msg.value);//Getting back the funds
        return true;
    }

    function safeTransfer(address, uint256) public pure {
        revert("MaliciousToken: transfer reverted");
    }
}
