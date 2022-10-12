// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../../governance/implementation/Governed.sol";
import "../interface/IWhitelist.sol";

contract Whitelist is IWhitelist, Governed {
    mapping(address => bool) public whitelist;

    constructor(IGovernanceSettings _governanceSettings, address _initialGovernance) 
        Governed(_governanceSettings, _initialGovernance)
    {}

    function isWhitelisted(address _address) external view returns (bool) {
        return whitelist[_address];
    }

    function addAddressToWhitelist(address _address) external onlyImmediateGovernance {
        _addAddressToWhitelist(_address);
    }

    function addAddressesToWhitelist(address[] memory _addresses) external onlyImmediateGovernance {
        for (uint256 i = 0; i < _addresses.length; i++) {
            _addAddressToWhitelist(_addresses[i]);
        }
    }

    function _addAddressToWhitelist(address _address) private {
        whitelist[_address] = true;
        emit Whitelisted(_address);
    }

}
