// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../interfaces/IWNat.sol";
import "../interfaces/IIAgentVault.sol";
import "../interfaces/IICollateralPool.sol";
import "./ERC20Mock.sol";

contract AssetManagerMock {
    IWNat private wNat;
    ERC20Mock public fasset;
    address private commonOwner;
    bool private checkForValidAgentVaultAddress = true;
    address private collateralPool;

    event AgentRedemptionInCollateral(address _recipient, uint256 _amountUBA);
    event AgentRedemption(address _recipient, string _underlying, uint256 _amountUBA, address payable _executor);

    uint256 internal maxRedemption = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
    uint256 internal timelockDuration = 0 days;
    uint256 public assetPriceMul = 1;
    uint256 public assetPriceDiv = 2;
    uint256 public lotSize = 1;
    uint public minPoolCollateralRatioBIPS = 0;

    constructor(IWNat _wNat) {
        wNat = _wNat;
    }

    function payoutNAT(IIAgentVault _agentVault, address payable _recipient, uint256 _amount) external {
        _agentVault.payoutNAT(wNat, _recipient, _amount);
    }

    function getWNat() external view returns (IWNat) {
        return wNat;
    }

    function callFunctionAt(address _contract, bytes memory _payload) external {
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory data) = _contract.call(_payload);
        require(success, string(data));
    }

    function setCommonOwner(address _owner) external {
        commonOwner = _owner;
    }

    function getAgentVaultOwner(address /*_agentVault*/) external view
        returns (address _ownerManagementAddress)
    {
        return commonOwner;
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

    function getCollateralPool(address /*_agentVault*/) external view returns (address) {
        return collateralPool;
    }

    function setCollateralPool(address pool) external {
        collateralPool = pool;
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Methods specific to collateral pool contract

    function redeemFromAgent(
        address /* _agentVault */, address _redeemer, uint256 _amountUBA,
        string memory _receiverUnderlyingAddress, address payable _executor
    ) external {
        fasset.burnAmount(msg.sender, _amountUBA);
        emit AgentRedemption(_redeemer, _receiverUnderlyingAddress, _amountUBA, _executor);
    }

    function redeemFromAgentInCollateral(
        address /* _agentVault */, address _redeemer, uint256 _amountUBA
    ) external {
        fasset.burnAmount(msg.sender, _amountUBA);
        emit AgentRedemptionInCollateral(_redeemer, _amountUBA);
    }

    function registerFAssetForCollateralPool(ERC20Mock _fasset) external {
        fasset = _fasset;
    }

    function getFAssetsBackedByPool(address /* _backer */) external view returns (uint256) {
        return fasset.totalSupply();
    }

    function maxRedemptionFromAgent(address /*agentVault*/) external view returns (uint256) {
        return maxRedemption;
    }

    function getCollateralPoolTokenTimelockSeconds() external view returns (uint256) {
        return timelockDuration;
    }

    function assetPriceNatWei() public view returns (uint256, uint256) {
        return (assetPriceMul, assetPriceDiv);
    }

    function fAsset()
        external view
        returns (IERC20)
    {
        return fasset;
    }

    function getAgentMinPoolCollateralRatioBIPS(address /* _agentVault */) external view returns (uint256) {
        return minPoolCollateralRatioBIPS;
    }

    /////////////////////////////////////////////////////////////////////////////
    // artificial setters for testing

    function setAssetPriceNatWei(uint256 _mul, uint256 _div) external {
        assetPriceMul = _mul;
        assetPriceDiv = _div;
    }

    function setLotSize(uint256 _lotSize) public {
        lotSize = _lotSize;
    }

    function setMaxRedemptionFromAgent(uint256 _maxRedemption) external {
        maxRedemption = _maxRedemption;
    }

    function setTimelockDuration(uint256 _timelockDuration) external {
        timelockDuration = _timelockDuration;
    }

    function setMinPoolCollateralRatioBIPS(uint256 _minPoolCollateralRatioBIPS) external {
        minPoolCollateralRatioBIPS = _minPoolCollateralRatioBIPS;
    }
}
