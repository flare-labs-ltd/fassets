// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


interface IPriceReader {

    /**
     * Returns the price for the given symbol.
     * @param _symbol The symbol.
     * @return _price The price.
     * @return _timestamp The timestamp of the voting round for which the price was calculated.
     * @return _priceDecimals The price decimals.
     */
    function getPrice(string memory _symbol)
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _priceDecimals);

    /**
     * Returns the price for the given symbol that was calculated by trusted providers.
     * @param _symbol The symbol.
     * @return _price The price.
     * @return _timestamp The timestamp of the voting round for which the price was calculated.
     * @return _priceDecimals The price decimals.
     */
    function getPriceFromTrustedProviders(string memory _symbol)
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _priceDecimals);

    /**
     * Returns the price for the given symbol that was calculated by trusted providers.
     * @param _symbol The symbol.
     * @return _price The price.
     * @return _timestamp The timestamp of the voting round for which the price was calculated.
     * @return _priceDecimals The price decimals.
     * @return _numberOfSubmits The number of submits that were used to calculate the price.
     */
    function getPriceFromTrustedProvidersWithQuality(string memory _symbol)
        external view
        returns (uint256 _price, uint256 _timestamp, uint256 _priceDecimals, uint8 _numberOfSubmits);
}
