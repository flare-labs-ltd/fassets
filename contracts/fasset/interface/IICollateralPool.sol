// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../userInterfaces/ICollateralPool.sol";
import "../interface/IIAssetManager.sol";
import "./IWNat.sol";

/**
 * Collateral pool methods that are only callable by the asset manager or pool token.
 */
interface IICollateralPool is ICollateralPool {
    function setPoolToken(address _poolToken) external;

    function depositNat() external payable;

    function payout(address _receiver, uint256 _amountWei, uint256 _agentResponsibilityWei) external;

    function destroy(address payable _recipient) external;

    function upgradeWNatContract(IWNat newWNat) external;

    function setExitCollateralRatioBIPS(uint256 _value) external;

    function setTopupCollateralRatioBIPS(uint256 _value) external;

    function setTopupTokenPriceFactorBIPS(uint256 _value) external;

    function fAssetFeeDeposited(uint256 _amount) external;

    function wNat() external view returns (IWNat);

    function debtFreeTokensOf(address _account) external view returns (uint256);

    function debtLockedTokensOf(address _account) external view returns (uint256);

    function assetManager() external view returns (IIAssetManager);
}
