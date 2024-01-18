// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../governance/implementation/Governed.sol";
import "../../userInterfaces/IWhitelist.sol";


contract Whitelist is IWhitelist, Governed, IERC165 {
    bool public immutable supportsRevoke;
    mapping(address => bool) private whitelist;

    constructor(IGovernanceSettings _governanceSettings, address _initialGovernance, bool _supportsRevoke)
        Governed(_governanceSettings, _initialGovernance)
    {
        supportsRevoke = _supportsRevoke;
    }

    function addAddressToWhitelist(address _address) external onlyImmediateGovernance {
        _addAddressToWhitelist(_address);
    }

    function addAddressesToWhitelist(address[] memory _addresses) external onlyImmediateGovernance {
        for (uint256 i = 0; i < _addresses.length; i++) {
            _addAddressToWhitelist(_addresses[i]);
        }
    }

    function revokeAddress(address _address) external onlyGovernance {
        require(supportsRevoke, "revoke not supported");
        _removeAddressFromWhitelist(_address);
    }

    function isWhitelisted(address _address) public view returns (bool) {
        return whitelist[_address];
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

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        public pure virtual override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IWhitelist).interfaceId;
    }
}
