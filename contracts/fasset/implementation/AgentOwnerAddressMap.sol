// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "../../userInterfaces/IAgentOwnerAddressMap.sol";
import "../interface/IWhitelist.sol";
import "../../governance/implementation/Governed.sol";


contract AgentOwnerAddressMap is Governed, IAgentOwnerAddressMap {
    IWhitelist public agentWhitelist;
    mapping(address => address) private workToMgmtAddress;
    mapping(address => address) private mgmtToWorkAddress;

    constructor(IGovernanceSettings _governanceSettings, address _initialGovernance, IWhitelist _agentWhitelist)
        Governed(_governanceSettings, _initialGovernance)
    {
        require(address(_agentWhitelist) != address(0), "agent whitelist zero");
        agentWhitelist = _agentWhitelist;
    }

    /**
     * Associate a work address with the agent owner's management address.
     * Every owner (management address) can have only one work address, so as soon as the new one is set, the old
     * one stops working.
     * NOTE: May only be called by an agent on the allowed agent list and only from the management address.
     */
    function setWorkAddress(address _ownerWorkAddress) external {
        require(agentWhitelist.isWhitelisted(msg.sender),
            "agent not whitelisted");
        require(_ownerWorkAddress == address(0) || workToMgmtAddress[_ownerWorkAddress] == address(0),
            "work address in use");
        // delete old work to management mapping
        address oldWorkAddress = mgmtToWorkAddress[msg.sender];
        if (oldWorkAddress != address(0)) {
            workToMgmtAddress[oldWorkAddress] = address(0);
        }
        // create a new bidirectional mapping
        mgmtToWorkAddress[msg.sender] = _ownerWorkAddress;
        if (_ownerWorkAddress != address(0)) {
            workToMgmtAddress[_ownerWorkAddress] = msg.sender;
        }
        emit WorkAddressChanged(msg.sender, oldWorkAddress, _ownerWorkAddress);
    }

    /**
     * Update agent whitelist (by governance).
     */
    function setAgentWhitelist(IWhitelist _agentWhitelist) external onlyGovernance {
        require(address(_agentWhitelist) != address(0), "agent whitelist zero");
        agentWhitelist = _agentWhitelist;
    }

    /**
     * Get the (unique) work address for the given management address.
     */
    function getWorkAddress(address _managementAddress) external view returns (address) {
        return mgmtToWorkAddress[_managementAddress];
    }

    /**
     * Get the (unique) management address for the given work address.
     */
    function getManagementAddress(address _workAddress) external view returns (address) {
        return workToMgmtAddress[_workAddress];
    }

}
