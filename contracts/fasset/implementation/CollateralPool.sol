// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../utils/lib/SafePct.sol";
import "../interface/IWNat.sol";
import "../interface/IIAssetManager.sol";
import "../interface/IIAgentVault.sol";
import "../interface/IICollateralPool.sol";
import "../interface/IFAsset.sol";
import "./CollateralPoolToken.sol";

contract CollateralPool is IICollateralPool, ReentrancyGuard {
    using SafeCast for uint256;
    using SafePct for uint256;

    struct AssetData {
        uint256 poolTokenSupply;
        uint256 agentBackedFAsset;
        uint256 poolNatBalance;
        uint256 poolFAssetFees;
        uint256 poolVirtualFAssetFees;
        uint256 assetPriceMul;
        uint256 assetPriceDiv;
    }

    uint256 internal constant MAX_NAT_TO_POOL_TOKEN_RATIO = 1000;
    uint256 public constant MIN_NAT_TO_ENTER = 1 ether;
    uint256 public constant MIN_TOKEN_SUPPLY_AFTER_EXIT = 1 ether;
    uint256 public constant MIN_NAT_BALANCE_AFTER_EXIT = 1 ether;

    address public immutable agentVault;
    IIAssetManager public immutable assetManager;
    IERC20 public immutable fAsset;
    CollateralPoolToken public token; // practically immutable

    IWNat public wNat;
    uint32 public exitCollateralRatioBIPS;
    uint32 public topupCollateralRatioBIPS;
    uint16 public topupTokenPriceFactorBIPS;
    bool private internalWithdrawal;

    mapping(address => uint256) private _fAssetFeeDebtOf;
    uint256 public totalFAssetFeeDebt;
    uint256 public totalFAssetFees;
    uint256 public totalCollateral;

    modifier onlyAssetManager {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
    }

    modifier onlyAgent {
        require(isAgentVaultOwner(msg.sender), "only agent");
        _;
    }

    constructor (
        address _agentVault,
        address _assetManager,
        address _fAsset,
        uint32 _exitCollateralRatioBIPS,
        uint32 _topupCollateralRatioBIPS,
        uint16 _topupTokenPriceFactorBIPS
    ) {
        agentVault = _agentVault;
        assetManager = IIAssetManager(_assetManager);
        fAsset = IERC20(_fAsset);
        wNat = assetManager.getWNat();
        exitCollateralRatioBIPS = _exitCollateralRatioBIPS;
        topupCollateralRatioBIPS = _topupCollateralRatioBIPS;
        topupTokenPriceFactorBIPS = _topupTokenPriceFactorBIPS;
    }

    receive() external payable {
        require(internalWithdrawal, "only internal use");
    }

    function setPoolToken(address _poolToken)
        external override
        onlyAssetManager
    {
        require(address(token) == address(0), "pool token already set");
        token = CollateralPoolToken(_poolToken);
    }

    function setExitCollateralRatioBIPS(uint256 _exitCollateralRatioBIPS)
        external override
        onlyAssetManager
    {
        require(_exitCollateralRatioBIPS > topupCollateralRatioBIPS, "value too low");
        exitCollateralRatioBIPS = _exitCollateralRatioBIPS.toUint32();
    }

    function setTopupCollateralRatioBIPS(uint256 _topupCollateralRatioBIPS)
        external override
        onlyAssetManager
    {
        require(_topupCollateralRatioBIPS < exitCollateralRatioBIPS, "value too high");
        topupCollateralRatioBIPS = _topupCollateralRatioBIPS.toUint32();
    }

    function setTopupTokenPriceFactorBIPS(uint256 _topupTokenPriceFactorBIPS)
        external override
        onlyAssetManager
    {
        require(_topupTokenPriceFactorBIPS < SafePct.MAX_BIPS, "value too high");
        topupTokenPriceFactorBIPS = _topupTokenPriceFactorBIPS.toUint16();
    }

    /**
     * @notice Enters the collateral pool by depositing some NAT
     * @param _fAssets                 Number of f-assets sent along the deposited NAT (not all may be used)
     * @param _enterWithFullFassets    Specifies whether "required" f-assets should be calculated automatically
     */
    function enter(uint256 _fAssets, bool _enterWithFullFassets)
        external payable override
        nonReentrant
    {
        AssetData memory assetData = _getAssetData();
        require(assetData.poolTokenSupply <= assetData.poolNatBalance * MAX_NAT_TO_POOL_TOKEN_RATIO,
            "pool nat balance too small");
        require(msg.value >= MIN_NAT_TO_ENTER, "amount of nat sent is too low");
        if (assetData.poolTokenSupply == 0) {
            require(msg.value >= assetData.poolNatBalance,
                "if pool has no tokens, but has collateral, you need to send at least that amount of collateral");
        }
        // calculate obtained pool tokens and free f-assets
        uint256 tokenShare = _collateralToTokenShare(assetData, msg.value);
        uint256 fAssetFeeShare = assetData.poolTokenSupply == 0 ?
            0 : assetData.poolVirtualFAssetFees.mulDiv(tokenShare, assetData.poolTokenSupply);
        uint256 depositedFAsset = _enterWithFullFassets ? fAssetFeeShare : Math.min(_fAssets, fAssetFeeShare);
        // transfer/mint calculated assets
        if (depositedFAsset > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= depositedFAsset,
                "f-asset allowance too small");
            _transferFAsset(msg.sender, address(this), depositedFAsset);
        }
        _mintFAssetFeeDebt(msg.sender, fAssetFeeShare - depositedFAsset);
        _depositWNat();
        assetManager.collateralDeposited(agentVault, wNat);
        token.mint(msg.sender, tokenShare);
        // emit event
        emit Enter(msg.sender, msg.value, tokenShare, depositedFAsset);
    }

    /**
     * @notice Exits the pool by liquidating the given amount of pool tokens
     * @param _tokenShare   The amount of pool tokens to be liquidated
     *                      Must be positive and smaller or equal to the sender's token balance
     * @param _exitType     An enum describing the ratio used to liquidate debt and free tokens
     */
    function exit(uint256 _tokenShare, TokenExitType _exitType)
        external override
        nonReentrant
        returns (uint256, uint256)
    {
        require(_tokenShare > 0, "token share is zero");
        require(_tokenShare <= token.balanceOf(msg.sender), "token balance too low");
        AssetData memory assetData = _getAssetData();
        require(assetData.poolTokenSupply == _tokenShare ||
            assetData.poolTokenSupply - _tokenShare >= MIN_TOKEN_SUPPLY_AFTER_EXIT,
            "token supply left after exit is too low and non-zero");
        // poolTokenSupply >= _tokenShare > 0
        uint256 natShare = _tokenShare.mulDiv(assetData.poolNatBalance, assetData.poolTokenSupply);
        require(natShare > 0, "amount of sent tokens is too small");
        require(assetData.poolNatBalance == natShare ||
            assetData.poolNatBalance - natShare >= MIN_NAT_BALANCE_AFTER_EXIT,
            "collateral left after exit is too low and non-zero");
        require(_staysAboveCR(assetData, natShare, exitCollateralRatioBIPS),
            "collateral ratio falls below exitCR");
        (uint256 debtFAssetFeeShare, uint256 freeFAssetFeeShare) = _getDebtAndFreeFAssetFeesFromTokenShare(
            assetData, msg.sender, _tokenShare, _exitType);
        // transfer/burn assets
        if (freeFAssetFeeShare > 0) {
            _transferFAsset(address(this), msg.sender, freeFAssetFeeShare);
        }
        if (debtFAssetFeeShare > 0) {
            _burnFAssetFeeDebt(msg.sender, debtFAssetFeeShare);
        }
        token.burn(msg.sender, _tokenShare);
        _transferWNat(address(this), msg.sender, natShare);
        // emit event
        emit Exit(msg.sender, _tokenShare, natShare, freeFAssetFeeShare, 0);
        return (natShare, freeFAssetFeeShare);
    }

    /**
     * @notice Exits the pool by liquidating the given amount of pool tokens and redeeming
     *  f-assets in a way that either preserves the pool collateral ratio or keeps it above exit CR
     * @param _tokenShare                   The amount of pool tokens to be liquidated
     *                                      Must be positive and smaller or equal to the sender's token balance
     * @param _redeemToCollateral           Specifies if agent should redeem f-assets in NAT from his collateral
     * @param _exitType                     An enum describing the ratio used to liquidate debt and free tokens
     * @param _redeemerUnderlyingAddress    Redeemer's address on the underlying chain
     * @notice F-assets will be redeemed in collateral if their value does not exceed one lot
     * @notice All f-asset fees will be redeemed along with potential additionally required f-assets taken
     *  from the sender's f-asset account
     */
    function selfCloseExit(
        uint256 _tokenShare,
        TokenExitType _exitType,
        bool _redeemToCollateral,
        string memory _redeemerUnderlyingAddress
    )
        external override
        nonReentrant
    {
        require(_tokenShare > 0, "token share is zero");
        uint256 tokenBalance = token.balanceOf(msg.sender);
        require(_tokenShare <= tokenBalance, "token balance too low");
        AssetData memory assetData = _getAssetData();
        require(assetData.poolTokenSupply == _tokenShare ||
            assetData.poolTokenSupply - _tokenShare >= MIN_TOKEN_SUPPLY_AFTER_EXIT,
            "token supply left after exit is too low and non-zero");
        uint256 natShare = assetData.poolNatBalance.mulDiv(
            _tokenShare, assetData.poolTokenSupply); // poolTokenSupply >= _tokenShare > 0
        require(natShare > 0, "amount of sent tokens is too small");
        require(assetData.poolNatBalance == natShare ||
            assetData.poolNatBalance - natShare >= MIN_NAT_BALANCE_AFTER_EXIT,
            "collateral left after exit is too low and non-zero");
        uint256 fAssetFees = _fAssetFeesOf(assetData, msg.sender);
        (uint256 debtFAssetFeeShare, uint256 freeFAssetFeeShare) = _getDebtAndFreeFAssetFeesFromTokenShare(
            assetData, msg.sender, _tokenShare, _exitType);
        uint256 requiredFAssets = _getFAssetRequiredToNotWorsenCR(assetData, natShare);
        // if there is more required f-assets than f-asset fees, calculate additionally required f-assets
        if (fAssetFees < requiredFAssets) {
            uint256 additionallyRequiredFAssets = requiredFAssets - fAssetFees;
            require(fAsset.allowance(msg.sender, address(this)) >= additionallyRequiredFAssets,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), additionallyRequiredFAssets);
        }
        // check if redemption is necessary
        if (requiredFAssets > 0) {
            // need to check whether the whole f-assets were redeemed by agent
            uint256 startPoolFAssetBalance = fAsset.balanceOf(address(this));
            if (requiredFAssets < assetManager.lotSize() || _redeemToCollateral) {
                assetManager.redeemFromAgentInCollateral(
                    agentVault, msg.sender, requiredFAssets);
            } else {
                assetManager.redeemFromAgent(
                    agentVault, msg.sender, requiredFAssets, _redeemerUnderlyingAddress);
            }
            uint256 endPoolFAssetBalance = fAsset.balanceOf(address(this));
            uint256 redeemedFAssets = startPoolFAssetBalance - endPoolFAssetBalance;
            // rare case: if agent has too many open tickets they can't redeem the
            // requiredFAssets in one step. We could lower the spent pool tokens to
            // match the spent f-assets, but for now we leave that to user and revert.
            require(redeemedFAssets == requiredFAssets,
                "agent cannot redeem required amount of f-assets, try lowering token share");
        }
        uint256 spentFAssetFees = Math.min(requiredFAssets, fAssetFees);
        if (spentFAssetFees > 0) {
            // fAssetFees consumed by requiredFAssets become debt
            totalFAssetFees -= spentFAssetFees;
            _mintFAssetFeeDebt(msg.sender, spentFAssetFees);
            uint256 spentFreeFAssetFeeShare = Math.min(spentFAssetFees, freeFAssetFeeShare);
            if (spentFreeFAssetFeeShare > 0) {
                // move spent free f-asset share to debt f-asset share
                freeFAssetFeeShare -= spentFreeFAssetFeeShare;
                debtFAssetFeeShare += spentFreeFAssetFeeShare;
            }
        }
        // transfer/burn tokens
        if (freeFAssetFeeShare > 0) {
            _transferFAsset(address(this), msg.sender, freeFAssetFeeShare);
        }
        if (debtFAssetFeeShare > 0) {
            _burnFAssetFeeDebt(msg.sender, debtFAssetFeeShare);
        }
        token.burn(msg.sender, _tokenShare);
        _transferWNat(address(this), msg.sender, natShare);
        // emit event
        emit Exit(msg.sender, _tokenShare, natShare, spentFAssetFees, requiredFAssets);
    }

    /**
     * @notice Collect f-asset fees by locking free tokens
     * @param _fAssets  The amount of f-asset fees to withdraw
     *                  Must be positive and smaller or equal to the sender's reward f-assets
     */
    function withdrawFees(uint256 _fAssets)
        external override
        nonReentrant
    {
        require(_fAssets > 0, "trying to withdraw zero f-assets");
        AssetData memory assetData = _getAssetData();
        uint256 freeFAssetFeeShare = _fAssetFeesOf(assetData, msg.sender);
        require(_fAssets <= freeFAssetFeeShare, "free f-asset balance too small");
        _mintFAssetFeeDebt(msg.sender, _fAssets);
        _transferFAsset(address(this), msg.sender, _fAssets);
        // emit event
        emit Exit(msg.sender, 0, 0, freeFAssetFeeShare, 0);
    }

    /**
     * @notice Free debt tokens by paying f-assets
     * @param _fAssets  Amount of payed f-assets
     *                  _fAssets must be positive and smaller or equal to the sender's debt f-assets
     */
    function payFAssetFeeDebt(uint256 _fAssets)
        external override
        nonReentrant
    {
        require(_fAssets <= _fAssetFeeDebtOf[msg.sender], "debt f-asset balance too small");
        require(fAsset.allowance(msg.sender, address(this)) >= _fAssets, "f-asset allowance too small");
        _burnFAssetFeeDebt(msg.sender, _fAssets);
        _transferFAsset(msg.sender, address(this), _fAssets);
        // emit event
        emit Enter(msg.sender, 0, 0, _fAssets);
    }

    /**
     * @notice Returns the collateral pool token contract used by this contract
     */
    function poolToken() external view override returns (ICollateralPoolToken) {
        return token;
    }

    function _collateralToTokenShare(
        AssetData memory _assetData,
        uint256 _collateral
    )
        internal view
        returns (uint256)
    {
        bool poolConsideredEmpty = _assetData.poolNatBalance == 0 || _assetData.poolTokenSupply == 0;
        // calculate nat share to be priced with topup discount and nat share to be priced standardly
        uint256 _aux = (_assetData.assetPriceMul * _assetData.agentBackedFAsset).mulBips(topupCollateralRatioBIPS);
        uint256 natRequiredToTopup = _aux > _assetData.poolNatBalance * _assetData.assetPriceDiv ?
            _aux / _assetData.assetPriceDiv - _assetData.poolNatBalance : 0;
        uint256 collateralForTopupPricing = Math.min(_collateral, natRequiredToTopup);
        uint256 collateralAtStandardPrice = collateralForTopupPricing < _collateral ?
            _collateral - collateralForTopupPricing : 0;
        uint256 collateralAtTopupPrice = collateralForTopupPricing.mulDiv(
            SafePct.MAX_BIPS, topupTokenPriceFactorBIPS);
        uint256 tokenShareAtStandardPrice = poolConsideredEmpty ?
            collateralAtStandardPrice : _assetData.poolTokenSupply.mulDiv(
                collateralAtStandardPrice, _assetData.poolNatBalance);
        uint256 tokenShareAtTopupPrice = poolConsideredEmpty ?
            collateralAtTopupPrice : _assetData.poolTokenSupply.mulDiv(
                collateralAtTopupPrice, _assetData.poolNatBalance);
        return tokenShareAtTopupPrice + tokenShareAtStandardPrice;
    }

    // _tokenShare is assumed to be smaller or equal to _account's token balance
    // this is implied in all methods calling the internal method, but not checked explicitly
    function _getDebtAndFreeFAssetFeesFromTokenShare(
        AssetData memory _assetData,
        address _account,
        uint256 _tokenShare,
        TokenExitType _exitType
    )
        internal view
        returns (uint256 debtFAssetFeeShare, uint256 freeFAssetFeeShare)
    {
        uint256 virtualFasset = _virtualFAssetFeesOf(_assetData, _account);
        uint256 debtFasset = _fAssetFeeDebtOf[_account];
        uint256 fAssetShare = virtualFasset.mulDiv(_tokenShare, token.balanceOf(_account));
        // note: it can happen that debtFasset = virtualFasset + 1 > virtualFasset
        if (_exitType == TokenExitType.MAXIMIZE_FEE_WITHDRAWAL) {
            uint256 freeFasset = debtFasset < virtualFasset ? virtualFasset - debtFasset : 0;
            freeFAssetFeeShare = Math.min(fAssetShare, freeFasset);
            debtFAssetFeeShare = fAssetShare - freeFAssetFeeShare;
        } else if (_exitType == TokenExitType.MINIMIZE_FEE_DEBT) {
            debtFAssetFeeShare = Math.min(fAssetShare, debtFasset);
            freeFAssetFeeShare = fAssetShare - debtFAssetFeeShare;
        } else { // KEEP_RATIO
            debtFAssetFeeShare = debtFasset > 0 ? debtFasset.mulDiv(fAssetShare, virtualFasset) : 0;
            // _tokenShare <= token.balanceOf(_account) implies fAssetShare <= virtualFasset
            // implies debtFAssetFeeShare <= fAssetShare
            freeFAssetFeeShare = fAssetShare - debtFAssetFeeShare;
        }
    }

    function _getFAssetRequiredToNotWorsenCR(
        AssetData memory _assetData,
        uint256 _natShare
    )
        internal view
        returns (uint256 requiredFAssets)
    {
        // calculate f-assets required to keep CR above min(exitCR, poolCR)
        // if pool is below exitCR, we shouldn't require it be increased above exitCR, only preserved
        // if pool is above exitCR, we require only for it to stay that way (like in the normal exit)
        if (_staysAboveCR(_assetData, 0, exitCollateralRatioBIPS)) {
            // f-assets required for CR to stay above exitCR (might not be needed)
            // If price is positive, we divide by a positive number as exitCollateralRatioBIPS >= 1
            uint256 _aux = _assetData.assetPriceDiv * (_assetData.poolNatBalance - _natShare) /
                _assetData.assetPriceMul.mulBips(exitCollateralRatioBIPS);
            requiredFAssets = _assetData.agentBackedFAsset > _aux ? _assetData.agentBackedFAsset - _aux : 0;
        } else {
            // f-assets that preserve CR
            requiredFAssets = _assetData.agentBackedFAsset.mulDiv(
                _natShare, _assetData.poolNatBalance); // poolNatBalance >= natShare > 0
        }
    }

    function _staysAboveCR(
        AssetData memory _assetData,
        uint256 _withdrawnNat,
        uint256 _crBIPS
    )
        internal pure
        returns (bool)
    {
        return (_assetData.poolNatBalance - _withdrawnNat) * _assetData.assetPriceDiv >=
            (_assetData.agentBackedFAsset * _assetData.assetPriceMul).mulBips(_crBIPS);
    }

    function _virtualFAssetFeesOf(
        AssetData memory _assetData,
        address _account
    )
        internal view
        returns (uint256)
    {
        uint256 tokens = token.balanceOf(_account);
        return _assetData.poolVirtualFAssetFees.mulDiv(
            tokens, _assetData.poolTokenSupply);
    }

    function _fAssetFeesOf(
        AssetData memory _assetData,
        address _account
    )
        internal view
        returns (uint256)
    {
        uint256 virtualFAssetFees = _virtualFAssetFeesOf(_assetData, _account);
        uint256 debtFAssetFees = _fAssetFeeDebtOf[_account];
        // note: rounding errors can make debtFassets larger than virtualFassets by at most one
        // this can happen only when user has no free f-assets
        return virtualFAssetFees > debtFAssetFees ? virtualFAssetFees - debtFAssetFees : 0;
    }

    function _transferableTokensOf(
        AssetData memory _assetData,
        address _account
    )
        internal view
        returns (uint256)
    {
        uint256 tokens = token.balanceOf(_account);
        if (tokens == 0) return 0; // prevents poolTokenSupply = 0
        uint256 debtFassets = _fAssetFeeDebtOf[_account];
        if (debtFassets == 0) return tokens; // prevents poolVirtualFAssetFees = 0
        uint256 virtualFassets = _assetData.poolVirtualFAssetFees.mulDiv(
            tokens, _assetData.poolTokenSupply);
        uint256 freeFassets = virtualFassets - debtFassets;
        uint256 freeTokens = _assetData.poolTokenSupply.mulDiv(
            freeFassets, _assetData.poolVirtualFAssetFees);
        return freeTokens;
    }

    function _getAssetData()
        internal view
        returns (AssetData memory)
    {
        uint256 poolFAssetFees = totalFAssetFees;
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        return AssetData({
            poolTokenSupply: token.totalSupply(),
            agentBackedFAsset: assetManager.getFAssetsBackedByPool(agentVault),
            poolNatBalance: totalCollateral,
            poolFAssetFees: poolFAssetFees,
            poolVirtualFAssetFees: poolFAssetFees + totalFAssetFeeDebt,
            assetPriceMul: assetPriceMul,
            assetPriceDiv: assetPriceDiv
        });
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // tracking wNat collateral and f-asset fees

    // this is needed to track asset manager's minting fee deposit
    function fAssetFeeDeposited(
        uint256 _amount
    )
        external
        onlyAssetManager
    {
        totalFAssetFees += _amount;
    }

    function _mintFAssetFeeDebt(address _account, uint256 _fassets)
        internal
    {
        _fAssetFeeDebtOf[_account] += _fassets;
        totalFAssetFeeDebt += _fassets;
    }

    // _fassets should be smaller or equal to _account's f-asset debt
    function _burnFAssetFeeDebt(address _account, uint256 _fassets)
        internal
    {
        _fAssetFeeDebtOf[_account] -= _fassets;
        totalFAssetFeeDebt -= _fassets;
    }

    function _transferFAsset(
        address _from,
        address _to,
        uint256 _amount
    )
        internal
    {
        if (_from == address(this)) {
            totalFAssetFees -= _amount;
            fAsset.transfer(_to, _amount);
        } else if (_to == address(this)) {
            /* solhint-disable reentrancy */
            totalFAssetFees += _amount;
            fAsset.transferFrom(_from, _to, _amount);
        }
    }

    function _transferWNat(
        address _from,
        address _to,
        uint256 _amount
    )
        internal
    {
        if (_from == address(this)) {
            totalCollateral -= _amount;
            wNat.transfer(_to, _amount);
        } else if (_to == address(this)) {
            /* solhint-disable reentrancy */
            totalCollateral += _amount;
            wNat.transferFrom(_from, _to, _amount);
        }
    }

    function _depositWNat()
        internal
    {
        totalCollateral += msg.value;
        wNat.deposit{value: msg.value}();
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // methods for viewing user balances

    /**
     * @notice Returns the sum of the user's reward f-assets and their corresponding f-asset debt
     * @param _account  User address
     */
    function virtualFAssetOf(address _account)
        external view
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return _virtualFAssetFeesOf(assetData, _account);
    }

    /**
     * @notice Returns user's reward f-assets
     * @param _account  User address
     */
    function fAssetFeesOf(address _account)
        external view override
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return _fAssetFeesOf(assetData, _account);
    }

    /**
     * @notice Returns user's f-asset debt
     * @param _account  User address
     */
    function fAssetFeeDebtOf(address _account)
        external view override
        returns (uint256)
    {
        return _fAssetFeeDebtOf[_account];
    }

    /**
     * @notice Returns user's debt tokens
     * @param _account  User address
     */
    function lockedTokensOf(address _account)
        external view
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return token.balanceOf(_account) - _transferableTokensOf(assetData, _account);
    }

    /**
     * @notice Returns user's free tokens
     * @param _account  User address
     */
    function transferableTokensOf(address _account)
        external view
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return _transferableTokensOf(assetData, _account);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Methods to allow for liquidation/destruction of the pool by AssetManager or agent

    function destroy(address payable _recipient)
        external override
        onlyAssetManager
    {
        require(totalCollateral == 0, "cannot destroy a pool holding collateral");
        require(totalFAssetFees == 0, "cannot destroy a pool holding f-assets");
        token.destroy(_recipient);
        selfdestruct(_recipient);
    }

    function payout(
        address _recipient,
        uint256 _amount,
        uint256 _agentResponsibilityWei
    )
        external override
        onlyAssetManager
        nonReentrant
    {
        AssetData memory assetData = _getAssetData();
        _transferWNat(address(this), _recipient, _amount);
        // slash agent vault's pool tokens worth _agentResponsibilityWei in FLR (or less if there is not enough)
        uint256 toSlashTokenMax = assetData.poolTokenSupply.mulDiv(_agentResponsibilityWei, assetData.poolNatBalance);
        uint256 toSlashToken = Math.min(toSlashTokenMax, token.balanceOf(agentVault));
        (uint256 debtFAssetFeeShare,) = _getDebtAndFreeFAssetFeesFromTokenShare(
            assetData, agentVault, toSlashToken, TokenExitType.KEEP_RATIO);
        _burnFAssetFeeDebt(agentVault, debtFAssetFeeShare);
        token.burn(agentVault, toSlashToken);
    }

    function upgradeWNatContract(IWNat _newWNat)
        external override
        onlyAssetManager
    {
        if (_newWNat == wNat) return;
        // transfer all funds to new WNat
        uint256 balance = wNat.balanceOf(address(this));
        internalWithdrawal = true;
        wNat.withdraw(balance);
        internalWithdrawal = false;
        _newWNat.deposit{value: balance}();
        // set new WNat contract
        wNat = _newWNat;
        assetManager.collateralDeposited(agentVault, wNat);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Delegation of the pool's collateral and airdrop claiming (same as in AgentVault)

    function claimAirdropDistribution(
        IDistributionToDelegators _distribution,
        uint256 _month
    )
        external override
        onlyAgent
        returns(uint256)
    {
        return _distribution.claim(address(this), payable(address(this)), _month, true);
    }

    function optOutOfAirdrop(
        IDistributionToDelegators _distribution
    )
        external override
        onlyAgent
    {
        _distribution.optOutOfAirdrop();
    }

    function delegateCollateral(
        address[] memory _to,
        uint256[] memory _bips
    )
        external override
        onlyAgent
    {
        wNat.batchDelegate(_to, _bips);
    }

    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager,
        uint256 _lastRewardEpoch
    )
        external override
        onlyAgent
    {
        _ftsoRewardManager.claim(address(this), payable(address(this)), _lastRewardEpoch, true);
    }

    // Set executors that can then automatically claim rewards through FtsoRewardManager.

    function setFtsoAutoClaiming(
        IClaimSetupManager _claimSetupManager,
        address[] memory _executors
    )
        external payable override
        onlyAgent
    {
        _claimSetupManager.setAutoClaiming{value: msg.value}(_executors, false);
        // no recipients setup - claim everything to pool
    }

    function isAgentVaultOwner(address _address)
        internal view
        returns (bool)
    {
        return assetManager.isAgentVaultOwner(agentVault, _address);
    }

    // in case of f-asset termination

    function withdrawCollateralWhenFAssetTerminated()
        external override
        nonReentrant
    {
        require(IFAsset(address(fAsset)).terminated(), "f-asset not terminated");
        uint256 tokens = token.balanceOf(msg.sender);
        require(tokens > 0, "nothing to withdraw");
        uint256 natShare = tokens.mulDiv(totalCollateral, token.totalSupply());
        token.burn(msg.sender, tokens); // when f-asset is terminated all tokens are free tokens
        _transferWNat(address(this), msg.sender, natShare);
    }

}
