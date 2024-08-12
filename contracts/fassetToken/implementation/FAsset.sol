// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "flare-smart-contracts/contracts/token/interface/IICleanable.sol";
import "../interfaces/IFAsset.sol";
import "../../governance/implementation/Governed.sol";
import "./CheckPointable.sol";


contract FAsset is IFAsset, IERC165, IICleanable, ERC20, CheckPointable {
    /**
     * The name of the underlying asset.
     */
    string public override assetName;

    /**
     * The symbol of the underlying asset.
     */
    string public override assetSymbol;

    /**
     * The contract that is allowed to set cleanupBlockNumber.
     * Usually this will be an instance of CleanupBlockNumberManager.
     */
    address public cleanupBlockNumberManager;

    /**
     * Get the asset manager, corresponding to this fAsset.
     * fAssets and asset managers are in 1:1 correspondence.
     */
    address public override assetManager;

    /**
     * Nonzero if f-asset is terminated (in that case its value is terminate timestamp).
     * Stopped f-asset can never be re-enabled.
     *
     * When f-asset is terminated, no transfers can be made anymore.
     * This is an extreme measure to be used as an optional last phase of asset manager upgrade,
     * when the asset manager minting has already been paused for a long time but there still exist
     * unredeemable f-assets, which at this point are considered unrecoverable (lost wallet keys etc.).
     * In such case, the f-asset contract is terminated and then agents can buy back their collateral at market rate
     * (i.e. they burn market value of backed f-assets in collateral to release the rest of the collateral).
     */
    uint64 public terminatedAt = 0;

    uint8 private _decimals;

    // the address that created this contract and is allowed to set initial settings
    address private _deployer;

    modifier onlyAssetManager() {
        require(msg.sender == assetManager, "only asset manager");
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _assetName,
        string memory _assetSymbol,
        uint8 _assetDecimals
    )
        ERC20(_name, _symbol)
    {
        _deployer = msg.sender;
        assetName = _assetName;
        assetSymbol = _assetSymbol;
        _decimals = _assetDecimals;
    }

    /**
     * Set asset manager contract this can be done only once and must be just after deploy
     * (otherwise nothing can be minted).
     */
    function setAssetManager(address _assetManager)
        external
    {
        require (msg.sender == _deployer, "only deployer");
        require(_assetManager != address(0), "zero asset manager");
        require(assetManager == address(0), "cannot replace asset manager");
        assetManager = _assetManager;
    }

    /**
     * Mints `_amount` od fAsset.
     * Only the assetManager corresponding to this fAsset may call `mint()`.
     */
    function mint(address _owner, uint256 _amount)
        external override
        onlyAssetManager
    {
        _mint(_owner, _amount);
    }

    /**
     * Burns `_amount` od fAsset.
     * Only the assetManager corresponding to this fAsset may call `burn()`.
     */
    function burn(address _owner, uint256 _amount)
        external override
        onlyAssetManager
    {
        _burn(_owner, _amount);
    }

    /**
     * Stops all transfers by setting `terminated` flag to true.
     * Only the assetManager corresponding to this fAsset may call `terminate()`.
     * Stop is irreversible.
     */
    function terminate()
        external override
        onlyAssetManager
    {
        if (terminatedAt == 0) {
            terminatedAt = uint64(block.timestamp);    // safe, block timestamp can never exceed 64bit
        }
    }

    /**
     * True if f-asset is terminated.
     */
    function terminated()
        external view override
        returns (bool)
    {
        return terminatedAt != 0;
    }

    /**
     * Implements IERC20Metadata method for configurable number of decimals.
     */
    function decimals() public view virtual override(ERC20, IERC20Metadata) returns (uint8) {
        return _decimals;
    }

    /**
     * Set the cleanup block number.
     * Historic data for the blocks before `cleanupBlockNumber` can be erased,
     * history before that block should never be used since it can be inconsistent.
     * In particular, cleanup block number must be before current vote power block.
     * @param _blockNumber The new cleanup block number.
     */
    function setCleanupBlockNumber(uint256 _blockNumber)
        external override
    {
        require(msg.sender == cleanupBlockNumberManager, "only cleanup block manager");
        _setCleanupBlockNumber(_blockNumber);
    }

    /**
     * Get the current cleanup block number.
     */
    function cleanupBlockNumber()
        external view override
        returns (uint256)
    {
        return _cleanupBlockNumber();
    }

    /**
     * Set the contract that is allowed to call history cleaning methods.
     */
    function setCleanerContract(address _cleanerContract)
        external override
        onlyAssetManager
    {
        _setCleanerContract(_cleanerContract);
    }

    /**
     * Set the contract that is allowed to set cleanupBlockNumber.
     * Usually this will be an instance of CleanupBlockNumberManager.
     */
    function setCleanupBlockNumberManager(address _cleanupBlockNumberManager)
        external
        onlyAssetManager
    {
        cleanupBlockNumberManager = _cleanupBlockNumberManager;
    }

    /**
     * Prevent transfer if f-asset is terminated.
     */
    function _beforeTokenTransfer(
        address _from,
        address _to,
        uint256 _amount
    )
        internal override
    {
        require(terminatedAt == 0, "f-asset terminated");
        require(_from == address(0) || balanceOf(_from) >= _amount, "f-asset balance too low");
        require(_from != _to, "Cannot transfer to self");
        // update balance history
        _updateBalanceHistoryAtTransfer(_from, _to, _amount);
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IERC20).interfaceId
            || _interfaceId == type(IERC20Metadata).interfaceId
            || _interfaceId == type(ICheckPointable).interfaceId
            || _interfaceId == type(IFAsset).interfaceId
            || _interfaceId == type(IICleanable).interfaceId;
    }
}
