// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../interface/IWNat.sol";
import "../interface/IAgentVault.sol";
import "../interface/ICollateralPool.sol";
import "./ERC20Mock.sol";

contract AssetManagerMock {
    IWNat private wNat;

    event AgentRedemptionInCollateral(uint256 _amountUBA);
    event AgentRedemption(uint256 _amountUBA);

    constructor(IWNat _wNat) {
        wNat = _wNat;
    }

    function payoutNAT(IAgentVault _agentVault, address payable _recipient, uint256 _amount) external {
        _agentVault.payoutNAT(_recipient, _amount);
    }

    function getWNat() external view returns (IWNat) {
        return wNat;
    }

    function callFunctionAt(address _contract, bytes memory _payload) external {
        (bool success, bytes memory data) = _contract.call(_payload);
        require(success, string(data));
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Methods specific to collateral pool contract

    function redeemFromAgent(
        address /* _agentVault */, address /* _redeemer */, uint256 _amountUBA,
        string memory /* _receiverUnderlyingAddress */
    ) external {
        emit AgentRedemption(_amountUBA);
    }

    function redeemFromAgentInCollateral(
        address /* _agentVault */, address /* _redeemer */, uint256 _amountUBA
    ) external {
        emit AgentRedemptionInCollateral(_amountUBA);
    }

    ERC20Mock public fasset;
    function registerFAssetForCollateralPool(ERC20Mock _fasset) external {
        fasset = _fasset;
    }

    function getFAssetsBackedByPool(address /* _backer */) external view returns (uint256) {
        return fasset.totalSupply();
    }

    function assetPriceNatWei() public pure returns (uint256, uint256) {
        return (1, 2);
    }

    function getLotSize() public pure returns (uint256) {
        return 1;
    }

}
