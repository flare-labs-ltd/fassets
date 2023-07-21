// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../interface/IWNat.sol";
import "../interface/IIAgentVault.sol";
import "../interface/IIContingencyPool.sol";
import "./ERC20Mock.sol";

contract AssetManagerMock {
    IWNat private wNat;
    ERC20Mock public fasset;
    address private commonOwner;
    bool private checkForValidAgentVaultAddress = true;
    address private contingencyPool;

    event AgentRedemptionInCollateral(uint256 _amountUBA);
    event AgentRedemption(uint256 _amountUBA);

    constructor(IWNat _wNat) {
        wNat = _wNat;
    }

    function payoutNAT(IIAgentVault _agentVault, address payable _recipient, uint256 _amount) external {
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
        returns (address _ownerManagementAddress, address _ownerWorkAddress)
    {
        return (commonOwner, address(0));
    }

    function isAgentVaultOwner(address /*_agentVault*/, address _address) external view returns (bool) {
        return _address == commonOwner;
    }

    function updateCollateral(address /* _agentVault */, IERC20 /*_token*/) external {
        commonOwner = commonOwner;  // just to prevent mutability warning
        require(!checkForValidAgentVaultAddress, "invalid agent vault address");
    }

    function setCheckForValidAgentVaultAddress(bool _check) external {
        checkForValidAgentVaultAddress = _check;
    }

    function getContingencyPool(address /*_agentVault*/) external view returns (address) {
        return contingencyPool;
    }

    function setContingencyPool(address pool) external {
        contingencyPool = pool;
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Methods specific to collateral pool contract

    function redeemFromAgent(
        address /* _agentVault */, address /* _redeemer */, uint256 _amountUBA,
        string memory /* _receiverUnderlyingAddress */
    ) external {
        fasset.burnAmount(msg.sender, _amountUBA);
        emit AgentRedemption(_amountUBA);
    }

    function redeemFromAgentInCollateral(
        address /* _agentVault */, address /* _redeemer */, uint256 _amountUBA
    ) external {
        fasset.burnAmount(msg.sender, _amountUBA);
        emit AgentRedemptionInCollateral(_amountUBA);
    }

    function registerFAssetForContingencyPool(ERC20Mock _fasset) external {
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

    uint256 public assetPriceMul = 1;
    uint256 public assetPriceDiv = 2;

    function assetPriceNatWei() public view returns (uint256, uint256) {
        return (assetPriceMul, assetPriceDiv);
    }

    function setAssetPriceNatWei(uint256 _mul, uint256 _div) external {
        assetPriceMul = _mul;
        assetPriceDiv = _div;
    }

    uint256 public lotSize = 1;

    function setLotSize(uint256 _lotSize) public {
        lotSize = _lotSize;
    }

    uint256 internal maxRedemption = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

    function maxRedemptionFromAgent(address /*agentVault*/) external view returns (uint256) {
        return maxRedemption;
    }

    function setMaxRedemptionFromAgent(uint256 _maxRedemption) external {
        maxRedemption = _maxRedemption;
    }

}
