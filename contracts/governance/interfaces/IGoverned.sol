// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "flare-smart-contracts/contracts/userInterfaces/IGovernanceSettings.sol";


interface IGoverned {
    event GovernanceCallTimelocked(bytes4 selector, uint256 allowedAfterTimestamp, bytes encodedCall);
    event TimelockedGovernanceCallExecuted(bytes4 selector, uint256 timestamp);
    event TimelockedGovernanceCallCanceled(bytes4 selector, uint256 timestamp);

    event GovernanceInitialised(address initialGovernance);
    event GovernedProductionModeEntered(address governanceSettings);

    function executeGovernanceCall(bytes4 _selector) external;
    function cancelGovernanceCall(bytes4 _selector) external;
    function switchToProductionMode() external;

    function governanceSettings() external view returns (IGovernanceSettings);
    function productionMode() external view returns (bool);
    function governance() external view returns (address);
    function isExecutor(address _address) external view returns (bool);
}
