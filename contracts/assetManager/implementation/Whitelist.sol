// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../../governance/implementation/Governed.sol";
import "../../userInterfaces/IWhitelist.sol";


contract Whitelist is IWhitelist, Governed, IERC165 {
    event ManagerChanged(address manager);

    /**
     * When true, governance can remove addresses from whitelist.
     */
    bool public immutable supportsRevoke;

    /**
     * When true, all addresses are whitelisted.
     * Default is false.
     */
    bool public allowAll;

    /**
     * When nonzero, this is the address that can perform whitelisting operations
     * instead of the governance.
     */
    address public manager;

    mapping(address => bool) private whitelist;

    modifier onlyGovernanceOrManager {
        require(msg.sender == manager || msg.sender == governance(), "only governance or manager");
        _;
    }

    constructor(IGovernanceSettings _governanceSettings, address _initialGovernance, bool _supportsRevoke)
        Governed(_governanceSettings, _initialGovernance)
    {
        supportsRevoke = _supportsRevoke;
        allowAll = false;
    }

    function addAddressToWhitelist(address _address) external onlyGovernanceOrManager {
        _addAddressToWhitelist(_address);
    }

    function addAddressesToWhitelist(address[] memory _addresses) external onlyGovernanceOrManager {
        for (uint256 i = 0; i < _addresses.length; i++) {
            _addAddressToWhitelist(_addresses[i]);
        }
    }

    function revokeAddress(address _address) external onlyGovernanceOrManager {
        require(supportsRevoke, "revoke not supported");
        _removeAddressFromWhitelist(_address);
    }

    function setAllowAll(bool _allowAll) external onlyGovernance {
        allowAll = _allowAll;
    }

    function setManager(address _manager) external onlyGovernance {
        manager = _manager;
        emit ManagerChanged(_manager);
    }

    function isWhitelisted(address _address) public view returns (bool) {
        return whitelist[_address] || allowAll;
    }

    function _addAddressToWhitelist(address _address) internal {
        require(_address != address(0), "address zero");
        if (whitelist[_address]) return;
        whitelist[_address] = true;
        emit Whitelisted(_address);
    }

    function _removeAddressFromWhitelist(address _address) internal {
        if (!whitelist[_address]) return;
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
