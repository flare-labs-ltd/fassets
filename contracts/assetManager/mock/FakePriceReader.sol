// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interfaces/IPriceReader.sol";
import "../interfaces/IPriceChangeEmitter.sol";


contract FakePriceReader is IPriceReader, IPriceChangeEmitter, IERC165 {
    using SafeCast for *;

    struct PricingData {
        uint8 decimals;
        uint128 price;
        uint64 timestamp;
        uint128 trustedPrice;
        uint64 trustedTimestamp;
    }

    address public provider;

    mapping(string symbol => PricingData) private pricingData;

    modifier onlyDataProvider {
        require(msg.sender == provider, "only provider");
        _;
    }

    constructor(address _provider)
    {
        provider = _provider;
    }

    function setDecimals(string memory _symbol, uint256 _decimals)
        external
        onlyDataProvider
    {
        pricingData[_symbol].decimals = _decimals.toUint8();
    }

    function setPrice(string memory _symbol, uint256 _price)
        external
        onlyDataProvider
    {
        PricingData storage data = _getPricingData(_symbol);
        data.price = _price.toUint128();
        data.timestamp = block.timestamp.toUint64();
    }

    function setPriceFromTrustedProviders(string memory _symbol, uint256 _price)
        external
        onlyDataProvider
    {
        PricingData storage data = _getPricingData(_symbol);
        data.trustedPrice = _price.toUint128();
        data.trustedTimestamp = block.timestamp.toUint64();
    }

    function finalizePrices()
        external
        onlyDataProvider
    {
        emit PriceEpochFinalized(address(0), 0);
        emit PricesPublished(0);
    }

    function getPrice(string memory _symbol)
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _priceDecimals)
    {
        PricingData storage data = _getPricingData(_symbol);
        return (data.price, data.timestamp, data.decimals);
    }

    function getPriceFromTrustedProviders(string memory _symbol)
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _priceDecimals)
    {
        PricingData storage data = _getPricingData(_symbol);
        return (data.trustedPrice, data.trustedTimestamp, data.decimals);
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IPriceReader).interfaceId
            || _interfaceId == type(IPriceChangeEmitter).interfaceId;
    }

    function _getPricingData(string memory _symbol)
        private view
        returns (PricingData storage)
    {
        PricingData storage data = pricingData[_symbol];
        require(data.decimals > 0, "price not initialized");
        return data;
    }
}
