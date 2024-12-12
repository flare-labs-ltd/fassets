// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";
import "../interfaces/IPriceReader.sol";
import "../../governance/implementation/AddressUpdatable.sol";


contract FtsoV1PriceReader is IPriceReader, IERC165, AddressUpdatable {
    IFtsoRegistry public ftsoRegistry;

    constructor(address _addressUpdater, IFtsoRegistry _ftsoRegistry)
        AddressUpdatable(_addressUpdater)
    {
        require(address(_ftsoRegistry) != address(0), "zero address");
        ftsoRegistry = _ftsoRegistry;
    }

    function getPrice(string memory _symbol)
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _priceDecimals)
    {
        return ftsoRegistry.getCurrentPriceWithDecimals(_symbol);
    }

    function getPriceFromTrustedProviders(string memory _symbol)
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _priceDecimals)
    {
        IIFtso ftso = ftsoRegistry.getFtsoBySymbol(_symbol);
        return ftso.getCurrentPriceWithDecimalsFromTrustedProviders();
    }

    function getPriceFromTrustedProvidersWithQuality(string memory _symbol)
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _priceDecimals, uint8 _numberOfSubmits)
    {
        IIFtso ftso = ftsoRegistry.getFtsoBySymbol(_symbol);
        (_price, _timestamp, _priceDecimals) = ftso.getCurrentPriceWithDecimalsFromTrustedProviders();
        _numberOfSubmits = 0; // info not available in V1
    }

    /**
     * @notice virtual method that a contract extending AddressUpdatable must implement
     */
    function _updateContractAddresses(
        bytes32[] memory _contractNameHashes,
        address[] memory _contractAddresses
    )
        internal override
    {
        ftsoRegistry = IFtsoRegistry(_getContractAddress(_contractNameHashes, _contractAddresses, "FtsoRegistry"));
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IPriceReader).interfaceId;
    }
}
