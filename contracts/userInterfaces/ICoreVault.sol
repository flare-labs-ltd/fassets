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
        uint32 redemptionFeeBIPS;
        uint32 transferTimeExtensionSeconds;
    }

    /**
     * Agent has transferred some of their backing to the core vault.
     */
    event TransferredToCoreVault(
        address indexed agentVault,
        uint256 transferRedemptionRequestId,
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
     * @param _agentVault the agent vault address
     * @param _amountUBA the amount to transfer to the core vault
     */
    function transferToCoreVault(address _agentVault, uint256 _amountUBA)
        external payable;

    /**
     * Return the core vault settings.
     */
    function getCoreVaultSettings()
        external view
        returns (CoreVaultSettings memory);
}
