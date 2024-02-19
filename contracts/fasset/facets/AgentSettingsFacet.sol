// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/assetManager/IAgentSettings.sol";
import "../library/AgentSettingsUpdater.sol";
import "./AssetManagerBase.sol";


contract AgentSettingsFacet is AssetManagerBase, IAgentSettings {
    /**
     * Due to effect on the pool, all agent settings are timelocked.
     * This method announces a setting change. The change can be executed after the timelock expires.
     * NOTE: may only be called by the agent vault owner.
     * @return _updateAllowedAt the timestamp at which the update can be executed
     */
    function announceAgentSettingUpdate(
        address _agentVault,
        string memory _name,
        uint256 _value
    )
        external override
        returns (uint256 _updateAllowedAt)
    {
        return AgentSettingsUpdater.announceUpdate(_agentVault, _name, _value);
    }

    /**
     * Due to effect on the pool, all agent settings are timelocked.
     * This method executes a setting change after the timelock expired.
     * NOTE: may only be called by the agent vault owner.
     */
    function executeAgentSettingUpdate(
        address _agentVault,
        string memory _name
    )
        external override
    {
        AgentSettingsUpdater.executeUpdate(_agentVault, _name);
    }
}
