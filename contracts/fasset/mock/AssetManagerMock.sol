// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../interface/IWNat.sol";
import "../interface/IAgentVault.sol";

contract AssetManagerMock {
    IWNat private wNat;

    constructor(IWNat _wNat) {
        wNat = _wNat;
    }

    function payoutNAT(IAgentVault _agentVault, address payable _recipient, uint256 _amount) external {
        _agentVault.payoutNAT(_recipient, _amount);
    }

    function getWNat() external view returns (IWNat) {
        return wNat;
    }

    function assetPriceNatWei() public pure returns (uint256, uint256) {
        return (1, 2);
    }

    function getLotSize() public pure returns (uint256) {
        return 10000;
    }
}
