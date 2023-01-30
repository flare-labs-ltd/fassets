// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract StakingPoolToken is ERC20 {

    uint256 public value;
    uint256 public fees;

    modifier onlyOwner() {
        require(msg.sender == address(this));
        _;
    }

    constructor(
        string memory agentId
    ) ERC20("StakingPoolToken", agentId) {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function _increaseValue(uint256 _amount) internal onlyOwner {
        value += _amount;
    }
    function _increaseFees(uint256 _fee) internal onlyOwner {
        fees += _fee;
    }
    function _decreaseValue(uint256 _amount) internal onlyOwner {
        require(value >= _amount, "total staked value too low");
        value -= _amount;
    }
    function _decreaseFees(uint256 _fee) internal onlyOwner {
        require(fees >= _fee, "total fee value too low");
        fees -= _fee;
    }
}