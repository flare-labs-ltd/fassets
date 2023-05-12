// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../interface/IWNat.sol";
import "../interface/IAgentVault.sol";
import "../interface/ICollateralPool.sol";
import "./ERC20Mock.sol";

contract AssetManagerMock {
    IWNat private wNat;
    ERC20Mock public fasset;
    address private commonOwner;
    bool private checkForValidAgentVaultAddress = true;
    address private collateralPool;

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

    function setCommonOwner(address _owner) external {
        commonOwner = _owner;
    }

    function getAgentVaultOwner(address /*_agentVault*/) external view
        returns (address _ownerColdAddress, address _ownerHotAddress)
    {
        return (commonOwner, address(0));
    }

    function isAgentVaultOwner(address /*_agentVault*/, address _address) external view returns (bool) {
        return _address == commonOwner;
    }

    function collateralDeposited(address /* _agentVault */, IERC20 /*_token*/) external {
        commonOwner = commonOwner;  // just to prevent mutability warning
        require(!checkForValidAgentVaultAddress, "invalid agent vault address");
    }

    function setCheckForValidAgentVaultAddress(bool _check) external {
        checkForValidAgentVaultAddress = _check;
    }

    function getCollateralPool(address /*_agentVault*/) external view returns (address) {
        return collateralPool;
    }

    function setCollateralPool(address pool) external {
        collateralPool = pool;
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

    function registerFAssetForCollateralPool(ERC20Mock _fasset) external {
        fasset = _fasset;
    }

    function getFAssetsBackedByPool(address /* _backer */) external view returns (uint256) {
        return fasset.totalSupply();
    }

    function fAsset()
        external view
        returns (IERC20)
    {
        return fasset;
    }

    function assetPriceNatWei() public pure returns (uint256, uint256) {
        return (1, 2);
    }

    function lotSize() public pure returns (uint256) {
        return 1;
    }

}
