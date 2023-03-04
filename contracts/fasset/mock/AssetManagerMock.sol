// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../interface/IWNat.sol";
import "../interface/IAgentVault.sol";
import "../interface/ICollateralPool.sol";

contract AssetManagerMock {
    IWNat private wNat;

    constructor(IWNat _wNat) {
        wNat = _wNat;
    }

    function payoutNAT(IAgentVault _agentVault, address payable _recipient, uint256 _amount) external {
        _agentVault.payoutNAT(_recipient, _amount);
    }

    function setPoolToken(ICollateralPool _collateralPool, address _poolToken) external {
        _collateralPool.setPoolToken(_poolToken);
    }

    function getWNat() external view returns (IWNat) {
        return wNat;
    }

    function redeemFromAgent(
        address _agentVault, address _receiver, uint256 _amountUBA, string memory _receiverUnderlyingAddress
    ) external pure {}

    function redeemFromAgentInCollateral(
        address _agentVault, address _receiver, uint256 _amountUBA
    ) external pure {}


    function assetPriceNatWei() public pure returns (uint256, uint256) {
        return (1, 2);
    }

    function getLotSize() public pure returns (uint256) {
        return 1000;
    }

}
