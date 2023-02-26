
// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {
    }

    function mintAmount(address _target, uint256 amount) public {
        _mint(_target, amount);
    }

    function deposit() public payable {
        _mint(msg.sender, msg.value);
    }
}