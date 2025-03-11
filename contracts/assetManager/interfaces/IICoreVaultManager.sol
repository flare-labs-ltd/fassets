// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../../userInterfaces/ICoreVaultManager.sol";

/**
 * Core vault manager internal interface
 */
interface IICoreVaultManager is ICoreVaultManager {

    event TransferRequested(
        string destinationAddress,
        uint256 amount,
        bool cancelable
    );

    event TransferRequestCanceled(
        string destinationAddress,
        uint256 amount
    );

    /**
     * Requests transfer from core vault to destination address.
     * @param _destinationAddress destination address
     * @param _amount amount
     * @param _cancelable cancelable flag (if true, the request can be canceled)
     * NOTE: destination address must be allowed otherwise the request will revert.
     * NOTE: may only be called by the asset manager.
     */
    function requestTransferFromCoreVault(
        string memory _destinationAddress,
        uint128 _amount,
        bool _cancelable
    )
        external;

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
