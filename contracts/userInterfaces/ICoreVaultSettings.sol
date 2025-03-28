// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Core vault settings
 */
interface ICoreVaultSettings {
    function setCoreVaultManager(address _coreVaultManager)
        external;

    function setCoreVaultNativeAddress(address payable _nativeAddress)
        external;

    function setCoreVaultTransferFeeBIPS(uint256 _transferFeeBIPS)
        external;

    function setCoreVaultTransferTimeExtensionSeconds(uint256 _transferTimeExtensionSeconds)
        external;

    function setCoreVaultRedemptionFeeBIPS(uint256 _redemptionFeeBIPS)
        external;

    function setCoreVaultMinimumAmountLeftBIPS(uint256 _minimumAmountLeftBIPS)
        external;

    function setCoreVaultMinimumRedeemLots(uint256 _minimumRedeemLots)
        external;

    function getCoreVaultManager()
        external view
        returns (address);

    function getCoreVaultNativeAddress()
        external view
        returns (address);

    function getCoreVaultTransferFeeBIPS()
        external view
        returns (uint256);

    function getCoreVaultTransferTimeExtensionSeconds()
        external view
        returns (uint256);

    function getCoreVaultRedemptionFeeBIPS()
        external view
        returns (uint256);

    function getCoreVaultMinimumAmountLeftBIPS()
        external view
        returns (uint256);

    function getCoreVaultMinimumRedeemLots()
        external view
        returns (uint256);
}
