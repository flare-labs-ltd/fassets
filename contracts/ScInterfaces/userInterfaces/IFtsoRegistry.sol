// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "./IFtso.sol";

interface IFtsoRegistry {

    function getFtso(uint256 _ftsoIndex) external view returns(IFtso _activeFtsoAddress);
    function getFtsoBySymbol(string memory _symbol) external view returns(IFtso _activeFtsoAddress);
    function getSupportedIndices() external view returns(uint256[] memory _supportedIndices);
    function getSupportedSymbols() external view returns(string[] memory _supportedSymbols);
    function getSupportedFtsos() external view returns(IFtso[] memory _ftsos);
    function getFtsoIndex(string memory _symbol) external view returns (uint256 _assetIndex);
    function getFtsoSymbol(uint256 _ftsoIndex) external view returns (string memory _symbol);
    function getCurrentPrice(uint256 _ftsoIndex) external view returns(uint256 _price, uint256 _timestamp);
    function getCurrentPrice(string memory _symbol) external view returns(uint256 _price, uint256 _timestamp);

    // This is new, but very useful in general
    // function getNatFtso() external view returns(IFtso _wnatFtso);

    function getSupportedIndicesAndFtsos() external view 
        returns(uint256[] memory _supportedIndices, IFtso[] memory _ftsos);

    function getSupportedSymbolsAndFtsos() external view 
        returns(string[] memory _supportedSymbols, IFtso[] memory _ftsos);

    function getSupportedIndicesAndSymbols() external view 
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols);

    function getSupportedIndicesSymbolsAndFtsos() external view 
        returns(uint256[] memory _supportedIndices, string[] memory _supportedSymbols, IFtso[] memory _ftsos);
}
