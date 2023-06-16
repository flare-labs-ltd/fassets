// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "flare-smart-contracts/contracts/userInterfaces/IFtsoRegistry.sol";


contract FtsoRegistryMock is IFtsoRegistry {
    mapping(string => uint256) private symbolIndex;
    IIFtso[] private ftsos;

    function addFtso(IIFtso _ftsoContract) external returns(uint256) {
        uint256 index = ftsos.length;
        ftsos.push(_ftsoContract);
        symbolIndex[_ftsoContract.symbol()] = index + 1;
        return index;
    }

    function getFtso(uint256 _ftsoIndex) public view returns(IIFtso _activeFtsoAddress) {
        require(_ftsoIndex < ftsos.length);
        return ftsos[_ftsoIndex];
    }

    function getFtsoBySymbol(string memory _symbol) public view returns(IIFtso _activeFtsoAddress) {
        return getFtso(getFtsoIndex(_symbol));
    }

    function getFtsos(uint256[] memory _indices) external view returns(IFtsoGenesis[] memory _ftsos) {
        _ftsos = new IFtsoGenesis[](_indices.length);
        for (uint256 i = 0; i < _indices.length; i++) {
            require(_indices[i] < ftsos.length);
            _ftsos[i] = ftsos[_indices[i]];
        }
    }

    function getFtsoIndex(string memory _symbol) public view returns (uint256) {
        uint256 index = symbolIndex[_symbol];
        require(index > 0, "unknown ftso symbol");
        return index - 1;
    }

    function getSupportedIndices() external view returns(uint256[] memory _supportedIndices) {
        _supportedIndices = new uint256[](ftsos.length);
        for (uint256 i = 0; i < _supportedIndices.length; i++) {
            _supportedIndices[i] = i + 1;
        }
    }

    function getSupportedSymbols() external view returns(string[] memory _supportedSymbols) {
        _supportedSymbols = new string[](ftsos.length);
        for (uint256 i = 0; i < _supportedSymbols.length; i++) {
            _supportedSymbols[i] = ftsos[i].symbol();
        }
    }

    function getSupportedFtsos() external view returns(IIFtso[] memory _ftsos) {
        return ftsos;
    }

    function getCurrentPrice(uint256 _ftsoIndex) external view returns(uint256 _price, uint256 _timestamp) {
        return getFtso(_ftsoIndex).getCurrentPrice();
    }

    function getCurrentPrice(string memory _symbol) external view returns(uint256 _price, uint256 _timestamp) {
        return getFtsoBySymbol(_symbol).getCurrentPrice();
    }

    function getCurrentPriceWithDecimals(uint256 _ftsoIndex) external view
        returns(uint256 _price, uint256 _timestamp, uint256 _assetPriceUsdDecimals)
    {
        return getFtso(_ftsoIndex).getCurrentPriceWithDecimals();
    }

    function getCurrentPriceWithDecimals(string memory _symbol) external view
        returns(uint256 _price, uint256 _timestamp, uint256 _assetPriceUsdDecimals)
    {
        return getFtsoBySymbol(_symbol).getCurrentPriceWithDecimals();
    }

    function getFtsoSymbol(uint256 _ftsoIndex) external view returns (string memory _symbol) {}
    function getSupportedIndicesAndFtsos() external view
        returns(uint256[] memory _supportedIndices, IIFtso[] memory _ftsos) {}
    function getSupportedSymbolsAndFtsos() external view
        returns(string[] memory _supportedSymbols, IIFtso[] memory _ftsos) {}
    function getSupportedIndicesAndSymbols() external view
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols) {}
    function getSupportedIndicesSymbolsAndFtsos() external view
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols, IIFtso[] memory _ftsos) {}
    function getAllCurrentPrices() external view returns (PriceInfo[] memory) {}
    function getCurrentPricesByIndices(uint256[] memory _indices) external view returns (PriceInfo[] memory) {}
    function getCurrentPricesBySymbols(string[] memory _symbols) external view returns (PriceInfo[] memory) {}
}
