// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


/**
 * Update agent settings with timelock.
 */
interface IAgentSettings {
    /**
     * Due to the effect on the pool, all agent settings are timelocked.
     * This method announces a setting change. The change can be executed after the timelock expires.
     * NOTE: may only be called by the agent vault owner.
     * @return _updateAllowedAt the timestamp at which the update can be executed
     */
    function announceAgentSettingUpdate(
        address _agentVault,
        string memory _name,
        uint256 _value
    ) external
        returns (uint256 _updateAllowedAt);

    /**
     * Due to the effect on the pool, all agent settings are timelocked.
     * This method executes a setting change after the timelock expires.
     * NOTE: may only be called by the agent vault owner.
     */
    function executeAgentSettingUpdate(
        address _agentVault,
        string memory _name
    ) external;
}
