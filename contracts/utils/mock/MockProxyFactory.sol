// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../assetManager/interfaces/IUpgradableContractFactory.sol";
import "./TestUUPSProxyImpl.sol";


contract MockProxyFactory is IUpgradableContractFactory {
    address public implementation;

    constructor(address _implementation) {
        implementation = _implementation;
    }

    function upgradeInitCall(address /* _proxy */) external pure override returns (bytes memory) {
        return abi.encodeCall(TestUUPSProxyImpl.initialize, ("some test string"));
    }
}
