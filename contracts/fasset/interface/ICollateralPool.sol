// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IWNat.sol";

interface ICollateralPool {
    enum TokenExitType { MAXIMIZE_FEE_WITHDRAWAL, MINIMIZE_FEE_DEBT, KEEP_RATIO }

    function enter(uint256 _fassets, bool _enterWithFullFassets) external payable;
    function exit(uint256 _tokenShare, TokenExitType _exitType)
        external
        returns (uint256 _natShare, uint256 _fassetShare);
    function withdrawFees(uint256 _amount) external;
    function selfCloseExit(
        uint256 _tokenShare, TokenExitType _exitType, bool _redeemToCollateral,
        string memory _redeemerUnderlyingAddress) external;
    function setPoolToken(address _poolToken) external;
    function payout(address _receiver, uint256 _amountWei, uint256 _agentResponsibilityWei) external;
    function destroy(address payable _recipient) external;
    function upgradeWNatContract(IWNat newWNat) external;
    function setExitCollateralRatioBIPS(uint256 _value) external;
    function setTopupCollateralRatioBIPS(uint256 _value) external;
    function setTopupTokenPriceFactorBIPS(uint256 _value) external;
    function poolToken() external view returns (IERC20);
    function exitCollateralRatioBIPS() external view returns (uint32);
    function topupCollateralRatioBIPS() external view returns (uint32);
    function topupTokenPriceFactorBIPS() external view returns (uint16);
}
