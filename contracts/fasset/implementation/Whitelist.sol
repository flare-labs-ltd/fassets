// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../../governance/implementation/Governed.sol";
import "../library/AMEvents.sol";
import "../interface/IWhitelist.sol";

abstract contract Whitelist is Governed, IWhitelist {
    mapping(address => bool) private whitelist;

    modifier onlyWhitelisted() {
        require(whitelisted(msg.sender), "only whitelisted");
        _;
    }

    function addToWhitelist(address _address) public onlyGovernance {
        whitelist[_address] = true;
        emit AMEvents.ContractChanged("whitelistAdd", _address);
    }

    function removeFromWhiteList(address _address) public onlyGovernance {
        whitelist[_address] = false;
        emit AMEvents.ContractChanged("whitelistRemove", _address);
    }

    function whitelisted(address _address) public view returns (bool) {
        return whitelist[_address];
    }

}
