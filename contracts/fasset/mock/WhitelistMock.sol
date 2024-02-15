// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/IWhitelist.sol";


contract WhitelistMock is IWhitelist {
    bool public allowAll;
    mapping(address => bool) private whitelist;

    constructor(bool _allowAll) {
        allowAll = _allowAll;
    }

    function addAddressToWhitelist(address _address) external {
        _addAddressToWhitelist(_address);
    }

    function addAddressesToWhitelist(address[] memory _addresses) external {
        for (uint256 i = 0; i < _addresses.length; i++) {
            _addAddressToWhitelist(_addresses[i]);
        }
    }

    function revokeAddress(address _address) external {
        _removeAddressFromWhitelist(_address);
    }

    function setAllowAll(bool _allowAll) external {
        allowAll = _allowAll;
    }

    function isWhitelisted(address _address) external view returns (bool) {
        return allowAll || whitelist[_address];
    }

    function _addAddressToWhitelist(address _address) private {
        require(_address != address(0), "address zero");
        whitelist[_address] = true;
        emit Whitelisted(_address);
    }

    function _removeAddressFromWhitelist(address _address) private {
        delete whitelist[_address];
        emit WhitelistingRevoked(_address);
    }
}
