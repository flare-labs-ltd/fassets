// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../implementation/FAsset.sol";


contract FAssetMock is FAsset {

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _assetName,
        string memory _assetSymbol,
        uint8 _decimals
    )
        FAsset(_name, _symbol, _assetName, _assetSymbol, _decimals)
    {}

    function mintAmount(address _target, uint256 amount) public {
        _mint(_target, amount);
    }
}
