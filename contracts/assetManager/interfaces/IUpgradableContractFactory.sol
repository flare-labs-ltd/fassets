// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * @title Common base for upgradable factories.
 */
interface IUpgradableContractFactory {
    /**
     * The implementation address for new proxies and upgrades.
     */
    function implementation() external view returns (address);

    /**
     * Returns the encoded init call, to be used in ERC1967 upgradeToAndCall.
     */
    function upgradeInitCall(address _proxy) external view returns (bytes memory);
}
