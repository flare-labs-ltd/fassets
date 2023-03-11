// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../interface/IWNat.sol";
import "../interface/IAgentVault.sol";
import "../interface/ICollateralPool.sol";

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

    function setPoolToken(ICollateralPool _collateralPool, address _poolToken) external {
        _collateralPool.setPoolToken(_poolToken);
    }

    function getWNat() external view returns (IWNat) {
        return wNat;
    }

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


    function assetPriceNatWei() public pure returns (uint256, uint256) {
        return (1, 2);
    }

    function getLotSize() public pure returns (uint256) {
        return 1;
    }

    function callFunction(address _contract, string memory _function, uint256 _argument) external {
        bytes memory payload = abi.encodeWithSignature(_function, _argument);
        // slither-disable-next-line avoid-low-level-calls
        (bool success,) = _contract.call(payload);
        require(success, "function call failed");
    }

}
