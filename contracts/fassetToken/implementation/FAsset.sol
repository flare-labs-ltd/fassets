// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "../interfaces/IIFAsset.sol";
import "../../assetManager/interfaces/IIAssetManager.sol";
import "../../governance/implementation/Governed.sol";
import "./CheckPointable.sol";


contract FAsset is IIFAsset, IERC165, ERC20, CheckPointable {
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
     * The account that will take over paying the transfer fees for another account (`_origin`).
     */
    mapping(address _origin => address _payingAccount) public transferFeesPaidBy;

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

    bool private _internalTransfer;

    string private _name;
    string private _symbol;
    uint8 private _decimals;

    // the address that created this contract and is allowed to set initial settings
    address private _deployer;
    bool private _initialized;

    modifier onlyAssetManager() {
        require(msg.sender == assetManager, "only asset manager");
        _;
    }

    constructor()
        ERC20("", "")
    {
        _initialized = true;
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        string memory assetName_,
        string memory assetSymbol_,
        uint8 decimals_
    )
        external
    {
        require(!_initialized, "already initialized");
        _initialized = true;
        _deployer = msg.sender;
        _name = name_;
        _symbol = symbol_;
        _decimals = decimals_;
        assetName = assetName_;
        assetSymbol = assetSymbol_;
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
     * Transfer fees are normally paid by the account that ran the transaction (tx.origin).
     * But it is possible to assign some other account to pay transfer fees.
     * Of course, that other account must set the allowance high enough.
     * @param _payingAccount the account that pays fees for fasset transactions
     *  where tx.origin is the caller of this method
     */
    function setTransferFeesPaidBy(address _payingAccount)
        external
    {
        transferFeesPaidBy[msg.sender] = _payingAccount;
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
     * Returns the name of the token.
     */
    function name() public view virtual override(ERC20, IERC20Metadata) returns (string memory) {
        return _name;
    }

    /**
     * Returns the symbol of the token, usually a shorter version of the name.
     */
    function symbol() public view virtual override(ERC20, IERC20Metadata) returns (string memory) {
        return _symbol;
    }
    /**
     * Implements IERC20Metadata method and returns configurable number of decimals.
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
     * Return the amount of fees that will be charged for the transfer of _transferAmount.
     * The fees are paid by the external account the initiated the transaction.
     */
    function transferFeeAmount(uint256 _transferAmount)
        external view
        returns (uint256)
    {
        return IIAssetManager(assetManager).fassetFeeForTransfer(_transferAmount);
    }

    /**
     * Transfer without charging fee. Used for transferring fees to agents.
     */
    function transferInternally(address _to, uint256 _amount)
        external
        onlyAssetManager
    {
        _internalTransfer = true;
        _transfer(msg.sender, _to, _amount);
        _internalTransfer = false;
    }

    /**
     * Prevent transfer if f-asset is terminated.
     */
    function _beforeTokenTransfer(address _from, address _to, uint256 _amount)
        internal override
    {
        require(terminatedAt == 0, "f-asset terminated");
        require(_from == address(0) || balanceOf(_from) >= _amount, "f-asset balance too low");
        require(_from != _to, "Cannot transfer to self");
        // update balance history
        _updateBalanceHistoryAtTransfer(_from, _to, _amount);
    }

    /**
     * Charge the fee for fasset transfer (not for minting or burning).
     */
    function _afterTokenTransfer(address _from, address _to, uint256 _amount)
        internal override
    {
        // Fee is not paid for minting, redeeming and internal transfers (transfering fee to asset manager).
        if (_internalTransfer || _from == address(0) || _to == address(0)) return;
        // Decide which account pays the fee.
        // By default it is tx.origin, which matches the way transaction gas is paid,
        // but the payment can be assigned to a different account (which must give enough allowance to tx.origin).
        // solhint-disable-next-line avoid-tx-origin
        address origin = tx.origin;
        address feePayer = transferFeesPaidBy[origin];
        if (feePayer == address(0)) {
            feePayer = origin;
        }
        // The two requires are present so that the caller can tell the difference between too low balance/allowance
        // for the payment and too low balance/allowance for the transfer fee.
        uint256 transferFee = IIAssetManager(assetManager).fassetFeeForTransfer(_amount);
        require(balanceOf(feePayer) >= transferFee, "balance too low for transfer fee");
        if (feePayer != origin) {
            require(allowance(feePayer, origin) >= transferFee, "allowance too low for transfer fee");
            _spendAllowance(feePayer, origin, transferFee);
        }
        // Make internal transfer, otherwise the system will try to charge fee for the fee transfer.
        _internalTransfer = true;
        _transfer(feePayer, assetManager, transferFee);
        _internalTransfer = false;
        // Update fee accounting on asset manager.
        IIAssetManager(assetManager).fassetTransferFeePaid(transferFee);
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
            || _interfaceId == type(IIFAsset).interfaceId
            || _interfaceId == type(IICleanable).interfaceId;
    }
}
