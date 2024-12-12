// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/Challenges.sol";
import "./AssetManagerBase.sol";


contract ChallengesFacet is AssetManagerBase {
    /**
     * Called with a proof of payment made from agent's underlying address, for which
     * no valid payment reference exists (valid payment references are from redemption and
     * underlying withdrawal announcement calls).
     * On success, immediately triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _transaction proof of a transaction from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function illegalPaymentChallenge(
        IBalanceDecreasingTransaction.Proof calldata _transaction,
        address _agentVault
    )
        external
        onlyWhitelistedSender
    {
        Challenges.illegalPaymentChallenge(_transaction, _agentVault);
    }

    /**
     * Called with proofs of two payments made from agent's underlying address
     * with the same payment reference (each payment reference is valid for only one payment).
     * On success, immediately triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _payment1 proof of first payment from the agent's underlying address
     * @param _payment2 proof of second payment from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function doublePaymentChallenge(
        IBalanceDecreasingTransaction.Proof calldata _payment1,
        IBalanceDecreasingTransaction.Proof calldata _payment2,
        address _agentVault
    )
        external
        onlyWhitelistedSender
    {
        Challenges.doublePaymentChallenge(_payment1, _payment2, _agentVault);
    }

    /**
     * Called with proofs of several (otherwise legal) payments, which together make agent's
     * underlying free balance negative (i.e. the underlying address balance is less than
     * the total amount of backed f-assets).
     * On success, immediately triggers full agent liquidation and rewards the caller.
     * NOTE: may only be called by a whitelisted caller when whitelisting is enabled.
     * @param _payments proofs of several distinct payments from the agent's underlying address
     * @param _agentVault agent vault address
     */
    function freeBalanceNegativeChallenge(
        IBalanceDecreasingTransaction.Proof[] calldata _payments,
        address _agentVault
    )
        external
        onlyWhitelistedSender
    {
        Challenges.paymentsMakeFreeBalanceNegative(_payments, _agentVault);
    }
}
