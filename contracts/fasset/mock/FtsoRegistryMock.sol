// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

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
    
    function getFtso(uint256 _ftsoIndex) external view returns(IIFtso _activeFtsoAddress) {
        require(_ftsoIndex < ftsos.length);
        return ftsos[_ftsoIndex];
    }
    
    function getFtsos(uint256[] memory _indices) external view returns(IFtsoGenesis[] memory _ftsos) {
        _ftsos = new IFtsoGenesis[](_indices.length);
        for (uint256 i = 0; i < _indices.length; i++) {
            require(_indices[i] < ftsos.length);
            _ftsos[i] = ftsos[_indices[i]];
        }
    }

    function getFtsoIndex(string memory _symbol) external view returns (uint256) {
        uint256 index = symbolIndex[_symbol];
        require(index > 0, "unknown ftso symbol");
        return index - 1;
    }
    
    function getFtsoBySymbol(string memory _symbol) external view returns(IIFtso _activeFtsoAddress) {}
    function getSupportedIndices() external view returns(uint256[] memory _supportedIndices) {}
    function getSupportedSymbols() external view returns(string[] memory _supportedSymbols) {}
    function getSupportedFtsos() external view returns(IIFtso[] memory _ftsos) {}
    function getFtsoSymbol(uint256 _ftsoIndex) external view returns (string memory _symbol) {}
    function getCurrentPrice(uint256 _ftsoIndex) external view returns(uint256 _price, uint256 _timestamp) {}
    function getCurrentPrice(string memory _symbol) external view returns(uint256 _price, uint256 _timestamp) {}

    function getSupportedIndicesAndFtsos() external view 
        returns(uint256[] memory _supportedIndices, IIFtso[] memory _ftsos) {}

    function getSupportedSymbolsAndFtsos() external view 
        returns(string[] memory _supportedSymbols, IIFtso[] memory _ftsos) {}

    function getSupportedIndicesAndSymbols() external view 
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols) {}

    function getSupportedIndicesSymbolsAndFtsos() external view 
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols, IIFtso[] memory _ftsos) {}
}
