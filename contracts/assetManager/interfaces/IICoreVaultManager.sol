// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../userInterfaces/ICoreVaultManager.sol";

/**
 * Core vault manager internal interface
 */
interface IICoreVaultManager is ICoreVaultManager {

    /**
     * Requests transfer from core vault to destination address.
     * @param _destinationAddress destination address
     * @param _paymentReference payment reference
     * @param _amount amount
     * @param _cancelable cancelable flag (if true, the request can be canceled)
     * @return _actualPaymentReference the actual payment reference that will be used - for non-cancelable requests
     *  it can differ from the requested payment reference, because multiple queued payments to the same address
     *  are merged in which case the reference of the previous payment to the same address will be used
     * NOTE: destination address must be allowed otherwise the request will revert.
     * NOTE: may only be called by the asset manager.
     */
    function requestTransferFromCoreVault(
        string memory _destinationAddress,
        bytes32 _paymentReference,
        uint128 _amount,
        bool _cancelable
    )
        external
        returns (bytes32 _actualPaymentReference);

    /**
     * Cancels transfer request from core vault.
     * @param _destinationAddress destination address
     * NOTE: if the request does not exist (anymore), the call will revert.
     * NOTE: may only be called by the asset manager.
     */
    function cancelTransferRequestFromCoreVault(
        string memory _destinationAddress
    )
        external;
}
