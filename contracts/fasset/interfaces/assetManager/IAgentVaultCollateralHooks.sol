// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../IWNat.sol";


/**
 * Functions, used by agent vault during collateral deposit/withdraw.
 */
interface IAgentVaultCollateralHooks {
    /**
     * Called by AgentVault when agent calls `withdraw()`.
     * NOTE: may only be called from an agent vault, not from an EOA address.
     * @param _valueNATWei the withdrawn amount
     */
    function beforeCollateralWithdrawal(
        IERC20 _token,
        uint256 _valueNATWei
    ) external;

    /**
     * Called by AgentVault when there was a deposit.
     * May pull agent out of liquidation.
     * NOTE: may only be called from an agent vault or collateral pool, not from an EOA address.
     */
    function updateCollateral(
        address _agentVault,
        IERC20 _token
    ) external;
}
