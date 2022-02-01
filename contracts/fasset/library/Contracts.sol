// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtso.sol";
import "flare-smart-contracts/contracts/userInterfaces/IPriceSubmitter.sol";
import "../interface/IWNat.sol";
import "./AssetManagerSettings.sol";


library Contracts {
    address internal constant PRICE_SUBMITTER_ADDRESS = 0x1000000000000000000000000000000000000003;
    
    IPriceSubmitter internal constant PRICE_SUBMITTER = IPriceSubmitter(PRICE_SUBMITTER_ADDRESS);
    
    function getFtsoRegistry() internal view returns (IFtsoRegistry) {
        return IFtsoRegistry(address(PRICE_SUBMITTER.getFtsoRegistry()));
    }
    
    function getFtso(uint256 _ftsoIndex) internal view returns(IFtso) {
        return getFtsoRegistry().getFtso(_ftsoIndex);
    }
    
    function getWNat(AssetManagerSettings.Settings storage _settings) internal view returns (IWNat) {
        return IWNat(address(getFtsoRegistry().getFtso(_settings.wnatIndex).wNat()));
    }
}
