// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/assetManager/IAgentCollateral.sol";
import "../interfaces/assetManager/IAgentVaultCollateralHooks.sol";
import "../../openzeppelin/security/ReentrancyGuard.sol";
import "../library/AgentsExternal.sol";
import "./AssetManagerBase.sol";


contract AgentCollateralFacet is AssetManagerBase, ReentrancyGuard, IAgentCollateral, IAgentVaultCollateralHooks {
    /**
     * Agent is going to withdraw `_valueNATWei` amount of collateral from agent vault.
     * This has to be announced and agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, agent can call withdraw(_valueNATWei) on agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     * @return _withdrawalAllowedAt the timestamp when the withdrawal can be made
     */
    function announceVaultCollateralWithdrawal(
        address _agentVault,
        uint256 _valueNATWei
    )
        external override
        returns (uint256 _withdrawalAllowedAt)
    {
        return AgentsExternal.announceWithdrawal(Collateral.Kind.VAULT, _agentVault, _valueNATWei);
    }

    /**
     * Agent is going to withdraw `_valueNATWei` amount of collateral from agent vault.
     * This has to be announced and agent must then wait `withdrawalWaitMinSeconds` time.
     * After that time, agent can call withdraw(_valueNATWei) on agent vault.
     * NOTE: may only be called by the agent vault owner.
     * @param _agentVault agent vault address
     * @param _valueNATWei the amount to be withdrawn
     * @return _redemptionAllowedAt the timestamp when the redemption can be made
     */
    function announceAgentPoolTokenRedemption(
        address _agentVault,
        uint256 _valueNATWei
    )
        external override
        returns (uint256 _redemptionAllowedAt)
    {
        return AgentsExternal.announceWithdrawal(Collateral.Kind.AGENT_POOL, _agentVault, _valueNATWei);
    }

    /**
     * Called by AgentVault when agent calls `withdraw()`.
     * NOTE: may only be called from an agent vault, not from an EOA address.
     * @param _valueNATWei the withdrawn amount
     */
    function beforeCollateralWithdrawal(
        IERC20 _token,
        uint256 _valueNATWei
    )
        external override
    {
        // AgentsExternal.beforeCollateralWithdrawal makes sure that only a registered agent vault can call
        AgentsExternal.beforeCollateralWithdrawal(_token, msg.sender, _valueNATWei);
    }

    /**
     * Called by AgentVault when there was a deposit.
     * May pull agent out of liquidation.
     * NOTE: may only be called from an agent vault or collateral pool, not from an EOA address.
     */
    function updateCollateral(
        address _agentVault,
        IERC20 _token
    )
        external override
    {
        // AgentsExternal.depositExecuted makes sure that only agent vault or pool can call
        AgentsExternal.depositExecuted(_agentVault, _token);
    }

    /**
     * If the current agent's vault collateral token gets deprecated, the agent must switch with this method.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: at the time of switch, the agent must have enough of both collaterals in the vault.
     */
    function switchVaultCollateral(
        address _agentVault,
        IERC20 _token
    )
        external override
    {
        AgentsExternal.switchVaultCollateral(_agentVault, _token);
    }

    /**
     * When current pool collateral token contract (WNat) is replaced by the method setPoolCollateralType,
     * pools don't switch automatically. Instead, the agent must call this method that swaps old WNat tokens for
     * new ones and sets it for use by the pool.
     */
    function upgradeWNatContract(
        address _agentVault
    )
        external override
    {
        // AgentsExternal.upgradeWNat checks that only agent owner can call
        AgentsExternal.upgradeWNatContract(_agentVault);
    }

    /**
     * When f-asset is terminated, agent can burn the market price of backed f-assets with his collateral,
     * to release the remaining collateral (and, formally, underlying assets).
     * This method ONLY works when f-asset is terminated, which will only be done when AssetManager is already paused
     * at least for a month and most f-assets are already burned and the only ones remaining are unrecoverable.
     * NOTE: may only be called by the agent vault owner.
     * NOTE: the agent (management address) receives the vault collateral and NAT is burned instead. Therefore
     *      this method is `payable` and the caller must provide enough NAT to cover the received vault collateral
     *      amount multiplied by `vaultCollateralBuyForFlareFactorBIPS`.
     */
    function buybackAgentCollateral(
        address _agentVault
    )
        external payable override
        nonReentrant
    {
        AgentsExternal.buybackAgentCollateral(_agentVault);
    }
}
