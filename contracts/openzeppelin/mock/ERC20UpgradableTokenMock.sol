// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

contract ERC20UpgradableTokenMock is ERC20, UUPSUpgradeable {
    string private _name;
    string private _symbol;
    bool private _initialized;

    constructor(string memory name_, string memory symbol_)
        ERC20("", "")
    {
        initialize(name_, symbol_);
    }

    function initialize(string memory name_, string memory symbol_) public {
        require(!_initialized, "already initialized");
        _initialized = true;
        _name = name_;
        _symbol = symbol_;
    }

    function name() public view virtual override returns (string memory) {
        return _name;
    }

    function symbol() public view virtual override returns (string memory) {
        return _symbol;
    }

    function mint(address account, uint256 amount) external virtual {
        _mint(account, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal override {
        // allow always
    }
}
