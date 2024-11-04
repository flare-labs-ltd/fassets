// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/interfaces/IERC1967.sol";


interface IUpgradableProxy is IERC1967 {
    /**
     * The current address of the proxy implementation.
     */
    function implementation() external view returns (address);

    /**
     * Upgrade proxy to new implementation.
     */
    function upgradeTo(address _newImplementation) external;

    /**
     * Upgrade proxy to new implementation and call an initialization method (via delegatecall).
     * @param _newImplementation the new implementation address
     * @param _initializeCall abi encoded call of some initialization method (as created by `abi.encodeCall`);
     *   if empty string is passed, no call is made
     */
    function upgradeToAndCall(address _newImplementation, bytes memory _initializeCall) external payable;
}
