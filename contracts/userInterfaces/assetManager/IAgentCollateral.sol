// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * Agent collateral handling by the agent owner.
 */
interface IAgentCollateral {
    /**
     * The agent is going to withdraw `_valueNATWei` amount of collateral from the agent vault.
     * This has to be announced and the agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, the agent can call `withdrawCollateral(_vaultCollateralToken, _valueNATWei)`
     * on the agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     * @return _withdrawalAllowedAt the timestamp when the withdrawal can be made
     */
    function announceVaultCollateralWithdrawal(
        address _agentVault,
        uint256 _valueNATWei
    ) external
        returns (uint256 _withdrawalAllowedAt);

    /**
     * The agent is going to redeem `_valueWei` collateral pool tokens in the agent vault.
     * This has to be announced and the agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, the agent can call `redeemCollateralPoolTokens(_valueNATWei)` on the agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     * @return _redemptionAllowedAt the timestamp when the redemption can be made
     */
    function announceAgentPoolTokenRedemption(
        address _agentVault,
        uint256 _valueNATWei
    ) external
        returns (uint256 _redemptionAllowedAt);

    /**
     * If the current agent's vault collateral token gets deprecated, the agent must switch with this method.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: at the time of switch, the agent must have enough of both collaterals in the vault.
     */
    function switchVaultCollateral(
        address _agentVault,
        IERC20 _token
    ) external;

    /**
     * When current pool collateral token contract (WNat) is replaced by the method setPoolCollateralType,
     * pools don't switch automatically. Instead, the agent must call this method that swaps old WNat tokens for
     * new ones and sets it for use by the pool.
     * NOTE: may only be called by the agent vault owner.
     */
    function upgradeWNatContract(
        address _agentVault
    ) external;

    /**
     * When f-asset is terminated, an agent can burn the market price of backed f-assets with his collateral,
     * to release the remaining collateral (and, formally, underlying assets).
     * This method ONLY works when f-asset is terminated, which will only be done when the asset manager
     * is already paused at least for a month and most f-assets are already burned and the only ones
     * remaining are unrecoverable.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the agent (management address) receives the vault collateral and NAT is burned instead. Therefore
     *      this method is `payable` and the caller must provide enough NAT to cover the received vault collateral
     *      amount multiplied by `vaultCollateralBuyForFlareFactorBIPS`.
     */
    function buybackAgentCollateral(
        address _agentVault
    ) external payable;
}
