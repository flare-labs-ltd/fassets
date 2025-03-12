// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "flare-smart-contracts-v2/contracts/userInterfaces/IFdcVerification.sol";


/**
 * Core vault
 */
interface ICoreVault {
    /**
     * Agent has requested transfer of (some of) their backing to the core vault.
     */
    event CoreVaultTransferStarted(
        address indexed agentVault,
        uint256 indexed transferRedemptionRequestId,
        uint256 valueUBA);

    /**
     * Agent has cancelled transfer to the core vault without paying.
     */
    event CoreVaultTransferCancelled(
        address indexed agentVault,
        uint256 indexed transferRedemptionRequestId);

    /**
     * The transfer of underlying to the core vault was successfuly completed.
     */
    event CoreVaultTransferSuccessful(
        address indexed agentVault,
        uint256 indexed transferRedemptionRequestId,
        uint256 valueUBA);

    /**
     * The agent has requested return of some of the underlying from the core vault to the agent's underlying address.
     */
    event ReturnFromCoreVaultRequested(
        address indexed agentVault,
        uint256 valueUBA);

    /**
     * The agent has cancelled the return request.
     */
    event ReturnFromCoreVaultCancelled(
        address indexed agentVault);

    /**
     * The payment from core vault to the agent's underlying address has been confirmed.
     */
    event ReturnFromCoreVaultConfirmed(
        address indexed agentVault,
        uint256 receivedUnderlyingUBA,
        uint256 reMintedUBA);

    /**
     * Redemption was requested from a core vault, because the redemption queue was empty.
     */
    event CoreVaultRedemptionRequested(
        address indexed redeemer,
        string paymentAddress,
        uint256 valueUBA);

    /**
     * Agent can transfer their backing to core vault.
     * They then get a redemption requests which the owner pays just like any other redemption request.
     * After that, the agent's collateral is released.
     * NOTE: only agent vault owner can call
     * @param _agentVault the agent vault address
     * @param _amountUBA the amount to transfer to the core vault
     */
    function transferToCoreVault(address _agentVault, uint256 _amountUBA)
        external payable;

    /**
     * Cancel a transfer to core vault.
     * If the payment was not made, this is the only way to release agent's collateral,
     * since redemption requests for transfer to core vault cannot default or expire.
     * NOTE: only agent vault owner can call
     * @param _agentVault the agent vault address
     */
    function cancelTransferToCoreVault(address _agentVault)
        external;

    /**
     * Request that core vault transfers funds to the agent's underlying address,
     * which makes them available for redemptions. This method reserves agent's collateral.
     * This may be sent by an agent when redemptions dominate mintings, so that the agents
     * are empty but want to earn from redemptions.
     * NOTE: only agent vault owner can call
     * NOTE: there can be only one active return request (until it is confirmed or cancelled).
     * @param _agentVault the agent vault address
     * @param _lots number of lots (same lots as for minting and redemptions)
     */
    function requestReturnFromCoreVault(address _agentVault, uint64 _lots)
        external;

    /**
     * Before the return request is processed, it can be cancelled, releasing the agent's reserved collateral.
     * @param _agentVault the agent vault address
     */
    function cancelReturnFromCoreVault(address _agentVault)
        external;

    /**
     * Confirm the payment from core vault to the agent's underlying address.
     * This adds the reserved funds to the agent's backing.
     * @param _payment FDC payment proof
     * @param _agentVault the agent vault address
     */
    function confirmReturnFromCoreVault(IPayment.Proof calldata _payment, address _agentVault)
        external;

    /**
     * Directly redeem from core vault by a user holding FAssets.
     * This is like ordinary redemption, but the redemption time is much longer (a day or more)
     * and there is no possibility of redemption.
     * @param _lots the number of lots, must be larger than `coreVaultMinimumRedeemLots` setting
     * @param _redeemerUnderlyingAddress the underlying address to which the assets will be redeemed;
     *      must have been added to the `allowedDestinations` list in the core vault manager by
     *      the governance before the redemption request.
     */
    function redeemFromCoreVault(uint64 _lots, string memory _redeemerUnderlyingAddress)
        external;

    /**
     * Return the amount of NAT that has to be paid in `transferToCoreVault` call.
     * @param _amountUBA the amount to transfer to the core vault
     * @return _transferFeeNatWei the amount that has to be included as `msg.value` and is paid to the core vault
     */
    function transferToCoreVaultFee(
        uint256 _amountUBA
    ) external view
        returns (uint256 _transferFeeNatWei);

    /**
     * Return the maximum amount that can be transfered and the minimum amount that
     * has to remain on the agent vault's underlying address.
     * @param _agentVault the agent vault address
     * @return _maximumTransferUBA maximum amount that can be transferred
     * @return _minimumLeftAmountUBA the minimum amount that has to remain on the agent vault's underlying address
     *  after the transfer
     */
    function maximumTransferToCoreVault(
        address _agentVault
    ) external view
        returns (uint256 _maximumTransferUBA, uint256 _minimumLeftAmountUBA);
}
