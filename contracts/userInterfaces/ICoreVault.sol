// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * Core vault
 */
interface ICoreVault {
    struct CoreVaultSettings {
        address coreVaultManager;
        address payable nativeAddress;
        uint16 transferFeeBIPS;
        uint32 redemptionFeeBIPS;
        uint16 minimumAmountLeftBIPS;
    }

    /**
     * Agent has requested transfer of (some of) their backing to the core vault.
     */
    event CoreVaultTransferStarted(
        address indexed agentVault,
        uint256 indexed transferRedemptionRequestId,
        uint256 valueUBA);

    /**
     * The transfer of underlying to the core vault was successfuly completed.
     */
    event CoreVaultTransferSuccessful(
        address indexed agentVault,
        uint256 indexed transferRedemptionRequestId,
        uint256 valueUBA);

    /**
     * Redemption was requested from a core vault, because the redemption queue was empty.
     */
    event CoreVaultRedemption(
        address indexed redeemer,
        uint256 indexed requestId,
        string paymentAddress,
        uint256 valueUBA,
        uint256 feeUBA,
        bytes32 paymentReference);

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
     * Return the amount of NAT that has to be paid in `transferToCoreVault` call.
     * @param _amountUBA the amount to transfer to the core vault
     * @return _transferFeeNatWei the amount that has to be included as `msg.value` and is paid to the core vault
     */
    function coreVaultTransferFee(
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
    function coreVaultMaximumTransfer(
        address _agentVault
    ) external view
        returns (uint256 _maximumTransferUBA, uint256 _minimumLeftAmountUBA);

    ////////////////////////////////////////////////////////////////////////////////////
    // Settings

    function setCoreVaultManager(
        address _coreVaultManager
    ) external;

    function setCoreVaultNativeAddress(
        address payable _nativeAddress
    ) external;

    function setCoreVaultTransferFeeBIPS(
        uint256 _transferFeeBIPS
    ) external;

    function setCoreVaultRedemptionFeeBIPS(
        uint256 _redemptionFeeBIPS
    ) external;

    function setCoreVaultMinimumAmountLeftBIPS(
        uint256 _minimumAmountLeftBIPS
    ) external;

    /**
     * Return the core vault settings.
     */
    function getCoreVaultSettings()
        external view
        returns (CoreVaultSettings memory);
}
