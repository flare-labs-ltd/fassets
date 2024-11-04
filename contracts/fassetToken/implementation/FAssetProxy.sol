// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/proxy/Proxy.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";
import "../../utils/interfaces/IUpgradableProxy.sol";
import "./FAsset.sol";


contract FAssetProxy is IUpgradableProxy, Proxy, ERC1967Upgrade {
    modifier onlyAssetManager {
        require(msg.sender == _assetManager(), "only asset manager");
        _;
    }

    constructor(
        address _implementationAddress,
        string memory _name,
        string memory _symbol,
        string memory _assetName,
        string memory _assetSymbol,
        uint8 _decimals
    ) {
        bytes memory initializeCall =
            abi.encodeCall(FAsset.initialize, (_name, _symbol, _assetName, _assetSymbol, _decimals));
        _upgradeToAndCall(_implementationAddress, initializeCall, false);
    }

    // some methods from ITransparentUpgradeableProxy

    function implementation() external view returns (address) {
        return _implementation();
    }

    function upgradeTo(address _newImplementation)
        external
        onlyAssetManager
    {
        _upgradeTo(_newImplementation);
    }

    function upgradeToAndCall(address _newImplementation, bytes memory _initializeCall)
        external payable
        onlyAssetManager
    {
        _upgradeToAndCall(_newImplementation, _initializeCall, false);
    }

    function _implementation() internal view virtual override returns (address) {
        return ERC1967Upgrade._getImplementation();
    }

    function _assetManager() internal returns (address) {
        bytes memory result =
            Address.functionDelegateCall(_implementation(), abi.encodeCall(IFAsset.assetManager, ()));
        return abi.decode(result, (address));
    }
}
