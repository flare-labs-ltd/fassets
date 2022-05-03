// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../../governance/implementation/Governed.sol";
import "../library/AMEvents.sol";
import "../interface/IWhitelist.sol";

contract Whitelist is IWhitelist, Governed {
    mapping(address => bool) public whitelist;

    modifier onlyWhitelisted() {
        require(whitelist[msg.sender], "only whitelisted");
        _;
    }

    constructor(address _governance) Governed(_governance) {}

    function isWhitelisted(address _address) external view returns (bool) {
        return whitelist[_address];
    }

    function addAddressToWhitelist(address _address) public onlyGovernance {
        whitelist[_address] = true;
        emit AMEvents.ContractChanged("whitelistAdd", _address);
    }

    function addAddressesToWhitelist(address[] memory _addresses) public onlyGovernance {
        for (uint256 i = 0; i < _addresses.length; i++) {
            addAddressToWhitelist(_addresses[i]);
        }
    }

}
