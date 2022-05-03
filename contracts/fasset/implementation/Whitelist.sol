// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../../governance/implementation/Governed.sol";
import "../library/AMEvents.sol";
import "../interface/IWhitelist.sol";

contract Whitelist is IWhitelist {
    mapping(address => bool) public whitelist;

    modifier onlyWhitelisted() {
        require(whitelist[msg.sender], "only whitelisted");
        _;
    }

    function addToWhitelist(address _address) external {
        whitelist[_address] = true;
        emit AMEvents.ContractChanged("whitelistAdd", _address);
    }

    function whitelisted(address _address) external view returns (bool) {
        return whitelist[_address];
    }

}
