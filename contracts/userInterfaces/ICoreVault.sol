// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * Core vault
 */
interface ICoreVault {
    struct CoreVaultSettings {
        address payable nativeAddress;
        address payable executorAddress;
        string underlyingAddressString;
        uint16 transferFeeBIPS;
        uint32 redemptionFeeBIPS;
        uint32 transferTimeExtensionSeconds;
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
     * The transfer of underlying to the core vault defaulted. The core vault's native address
     * received vault collateral (and possibly pool WNat).
     */
    event CoreVaultTransferDefault(
        address indexed agentVault,
        uint256 indexed transferRedemptionRequestId,
        uint256 expectedValueUBA,
        address paidVaultCollateralToken,
        uint256 paidVaultCollateralAmount,
        uint256 paidPoolWNatAmount);

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
     * @param _agentVault the agent vault address
     * @param _amountUBA the amount to transfer to the core vault
     */
    function transferToCoreVault(address _agentVault, uint256 _amountUBA)
        external payable;

    /**
     * Return the amount of NAT that has to be paid in `transferToCoreVault` call.
     * @param _amountUBA the amount to transfer to the core vault
     * @return _transferFeeNatWei the amount that has to be included as `msg.value` and is paid to the core vault
     */
    function coreVaultTransferFee(
        uint256 _amountUBA
    ) external view
        returns (uint256 _transferFeeNatWei);

    ////////////////////////////////////////////////////////////////////////////////////
    // Settings

    function setCoreVaultAddress(
        address payable _nativeAddress,
        string memory _underlyingAddressString
    ) external;

    function setCoreVaultExecutorAddress(
        address payable _executorAddress
    ) external;

    function setCoreVaultTransferFeeBIPS(
        uint256 _transferFeeBIPS
    ) external;

    function setCoreVaultRedemptionFeeBIPS(
        uint256 _redemptionFeeBIPS
    ) external;

    function setCoreVaultTransferTimeExtensionSeconds(
        uint256 _transferTimeExtensionSeconds
    ) external;

    /**
     * Return the core vault settings.
     */
    function getCoreVaultSettings()
        external view
        returns (CoreVaultSettings memory);
}
