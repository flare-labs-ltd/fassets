// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "./FAsset.sol";


contract FAssetProxy is ERC1967Proxy {
    constructor(
        address _implementationAddress,
        string memory _name,
        string memory _symbol,
        string memory _assetName,
        string memory _assetSymbol,
        uint8 _decimals
    )
        ERC1967Proxy(_implementationAddress,
            abi.encodeCall(FAsset.initialize, (_name, _symbol, _assetName, _assetSymbol, _decimals))
        )
    {
    }
}
