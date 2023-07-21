// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../../utils/lib/SafePct.sol";
import "../interface/IWNat.sol";
import "../interface/IIAssetManager.sol";
import "../interface/IIAgentVault.sol";
import "../interface/IIContingencyPool.sol";
import "../interface/IFAsset.sol";
import "./ContingencyPoolToken.sol";


//slither-disable reentrancy    // all possible reentrancies guarded by nonReentrant
contract ContingencyPool is IIContingencyPool, ReentrancyGuard, IERC165 {
    using SafeCast for uint256;
    using SafePct for uint256;
    using SafeERC20 for IERC20;
    using SafeERC20 for IWNat;

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
    ContingencyPoolToken public token; // practically immutable

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
        external
        onlyAssetManager
    {
        require(address(token) == address(0), "pool token already set");
        token = ContingencyPoolToken(_poolToken);
    }

    function setExitCollateralRatioBIPS(uint256 _exitCollateralRatioBIPS)
        external
        onlyAssetManager
    {
        require(_exitCollateralRatioBIPS > topupCollateralRatioBIPS, "value too low");
        exitCollateralRatioBIPS = _exitCollateralRatioBIPS.toUint32();
    }

    function setTopupCollateralRatioBIPS(uint256 _topupCollateralRatioBIPS)
        external
        onlyAssetManager
    {
        require(_topupCollateralRatioBIPS < exitCollateralRatioBIPS, "value too high");
        topupCollateralRatioBIPS = _topupCollateralRatioBIPS.toUint32();
    }

    function setTopupTokenPriceFactorBIPS(uint256 _topupTokenPriceFactorBIPS)
        external
        onlyAssetManager
    {
        require(_topupTokenPriceFactorBIPS < SafePct.MAX_BIPS, "value too high");
        topupTokenPriceFactorBIPS = _topupTokenPriceFactorBIPS.toUint16();
    }

    /**
     * @notice Enters the collateral pool by depositing some NAT
     * @param _fAssets                 Number of f-assets sent along the deposited NAT (not all may be used)
     * @param _enterWithFullFAssets    Specifies whether "required" f-assets should be calculated automatically
     */
    // slither-disable-next-line reentrancy-eth         // guarded by nonReentrant
    function enter(uint256 _fAssets, bool _enterWithFullFAssets)
        external payable override
        nonReentrant
    {
        AssetData memory assetData = _getAssetData();
        require(assetData.poolTokenSupply <= assetData.poolNatBalance * MAX_NAT_TO_POOL_TOKEN_RATIO,
            "pool nat balance too small");
        require(msg.value >= MIN_NAT_TO_ENTER, "amount of nat sent is too low");
        if (assetData.poolTokenSupply == 0) {
            // this conditions are set for keeping a stable token value
            require(msg.value >= assetData.poolNatBalance,
                "if pool has no tokens, but holds collateral, you need to send at least that amount of collateral");
            require(msg.value >= assetData.poolFAssetFees.mulDiv(assetData.assetPriceMul, assetData.assetPriceDiv),
                "If pool has no tokens, but holds f-asset, you need to send at least f-asset worth of collateral");
        }
        // calculate obtained pool tokens and free f-assets
        uint256 tokenShare = _collateralToTokenShare(assetData, msg.value);
        uint256 fAssetShare = assetData.poolTokenSupply > 0 ?
            assetData.poolVirtualFAssetFees.mulDiv(tokenShare, assetData.poolTokenSupply) : 0;
        uint256 depositedFAsset = _enterWithFullFAssets ? fAssetShare : Math.min(_fAssets, fAssetShare);
        // transfer/mint calculated assets
        if (depositedFAsset > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= depositedFAsset,
                "f-asset allowance too small");
            _transferFAsset(msg.sender, address(this), depositedFAsset);
        }
        _mintFAssetFeeDebt(msg.sender, fAssetShare - depositedFAsset);
        _depositWNat();
        assetManager.updateCollateral(agentVault, wNat);
        token.mint(msg.sender, tokenShare);
        // emit event
        emit Entered(msg.sender, msg.value, tokenShare, depositedFAsset);
    }

    /**
     * @notice Exits the pool by liquidating the given amount of pool tokens
     * @param _tokenShare   The amount of pool tokens to be liquidated
     *                      Must be positive and smaller or equal to the sender's token balance
     * @param _exitType     An enum describing the ratio used to liquidate debt and free tokens
     */
    // slither-disable-next-line reentrancy-eth         // guarded by nonReentrant
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
        _transferWNat(msg.sender, natShare);
        // emit event
        emit Exited(msg.sender, _tokenShare, natShare, freeFAssetFeeShare, 0);
        return (natShare, freeFAssetFeeShare);
    }

    /**
     * @notice Exits the pool by liquidating the given amount of pool tokens and redeeming
     *  f-assets in a way that either preserves the pool collateral ratio or keeps it above exit CR
     * @param _tokenShare                   The amount of pool tokens to be liquidated
     *                                      Must be positive and smaller or equal to the sender's token balance
     * @param _redeemToCollateral           Specifies if agent should redeem f-assets in NAT from his collateral
     * @param _redeemerUnderlyingAddress    Redeemer's address on the underlying chain
     * @notice F-assets will be redeemed in collateral if their value does not exceed one lot
     * @notice All f-asset fees will be redeemed along with potential additionally required f-assets taken
     *  from the sender's f-asset account
     */
    // slither-disable-next-line reentrancy-eth         // guarded by nonReentrant
    function selfCloseExit(
        uint256 _tokenShare,
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
        uint256 maxAgentRedemption = assetManager.maxRedemptionFromAgent(agentVault);
        uint256 requiredFAssets = _getFAssetRequiredToNotSpoilCR(assetData, natShare);
        // rare case: if agent has too many low-valued open tickets they can't redeem the requiredFAssets
        // in one transaction. In that case we lower/correct the amount of spent tokens and nat share.
        if (maxAgentRedemption < requiredFAssets) {
            // natShare and _tokenShare decrease!
            requiredFAssets = maxAgentRedemption;
            natShare = _getNatRequiredToNotSpoilCR(assetData, requiredFAssets);
            require(natShare > 0, "amount of sent tokens is too small after agent max redempton correction");
            require(assetData.poolNatBalance == natShare ||
                assetData.poolNatBalance - natShare >= MIN_NAT_BALANCE_AFTER_EXIT,
                "collateral left after exit is too low and non-zero");
            // poolNatBalance >= previous natShare > 0
            _tokenShare = assetData.poolTokenSupply.mulDiv(natShare, assetData.poolNatBalance);
            emit IncompleteSelfCloseExit(_tokenShare, requiredFAssets);
        }
        // get owner f-asset fees to be spent (maximize fee withdrawal to cover the potentially necessary f-assets)
        uint256 fAssetFees = _fAssetFeesOf(assetData, msg.sender);
        (uint256 debtFAssetFeeShare, uint256 freeFAssetFeeShare) = _getDebtAndFreeFAssetFeesFromTokenShare(
            assetData, msg.sender, _tokenShare, TokenExitType.MAXIMIZE_FEE_WITHDRAWAL);
        // if owner f-asset fees do not cover the required f-assets, require additional f-assets
        if (fAssetFees < requiredFAssets) {
            uint256 additionallyRequiredFAssets = requiredFAssets - fAssetFees;
            require(fAsset.allowance(msg.sender, address(this)) >= additionallyRequiredFAssets,
                "f-asset allowance too small");
            fAsset.safeTransferFrom(msg.sender, address(this), additionallyRequiredFAssets);
        }
        // redeem f-assets if necessary
        if (requiredFAssets > 0) {
            if (requiredFAssets < assetManager.lotSize() || _redeemToCollateral) {
                assetManager.redeemFromAgentInCollateral(
                    agentVault, msg.sender, requiredFAssets);
            } else {
                assetManager.redeemFromAgent(
                    agentVault, msg.sender, requiredFAssets, _redeemerUnderlyingAddress);
            }
        }
        // sort out the sender's f-asset fees that were spent on redemption
        uint256 spentFAssetFees = Math.min(requiredFAssets, fAssetFees);
        if (spentFAssetFees > 0) {
            // fAssetFees consumed by requiredFAssets become debt
            // solhint-disable reentrancy (is non-reentrant)
            totalFAssetFees -= spentFAssetFees;
            _mintFAssetFeeDebt(msg.sender, spentFAssetFees);
            uint256 spentFreeFAssetFeeShare = Math.min(spentFAssetFees, freeFAssetFeeShare);
            // move spent free f-asset share to debt f-asset share
            // (spentFreeFAssetFeeShare > 0 as TokenExitType.MAXIMIZE_FEE_WITHDRAWAL was used)
            freeFAssetFeeShare -= spentFreeFAssetFeeShare;
            debtFAssetFeeShare += spentFreeFAssetFeeShare;
        }
        // transfer/burn tokens
        if (freeFAssetFeeShare > 0) {
            _transferFAsset(address(this), msg.sender, freeFAssetFeeShare);
        }
        if (debtFAssetFeeShare > 0) {
            _burnFAssetFeeDebt(msg.sender, debtFAssetFeeShare);
        }
        token.burn(msg.sender, _tokenShare);
        _transferWNat(msg.sender, natShare);
        // emit event
        emit Exited(msg.sender, _tokenShare, natShare, spentFAssetFees, requiredFAssets);
    }

    /**
     * Get the amount of fassets that need to be burned to perform self close exit.
     */
    function fAssetRequiredForSelfCloseExit(uint256 _tokenAmountWei)
        external view
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        uint256 natWei = assetData.poolNatBalance.mulDiv(_tokenAmountWei, assetData.poolTokenSupply);
        uint256 requiredFAssets = _getFAssetRequiredToNotSpoilCR(assetData, natWei);
        uint256 fAssetFees = _fAssetFeesOf(assetData, msg.sender);
        return subOrZero(requiredFAssets, fAssetFees);
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
        emit Exited(msg.sender, 0, 0, freeFAssetFeeShare, 0);
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
        emit Entered(msg.sender, 0, 0, _fAssets);
    }

    /**
     * @notice Returns the collateral pool token contract used by this contract
     */
    function poolToken() external view override returns (IContingencyPoolToken) {
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
        uint256 collateralAtStandardPrice = subOrZero(_collateral, collateralForTopupPricing);
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
        uint256 virtualFAsset = _virtualFAssetFeesOf(_assetData, _account);
        uint256 debtFAsset = _fAssetFeeDebtOf[_account];
        uint256 tokens = token.balanceOf(_account);
        if (tokens == 0) return (0, 0); // never happens in this contract
        uint256 fAssetShare = virtualFAsset.mulDiv(_tokenShare, tokens);
        // note: rounding errors can be responsible for:
        // - debtFAsset = virtualFAsset + 1 > virtualFAsset
        // - freeFAsset > totalFAssetFees (not necessarily by 1, but should be small)
        if (_exitType == TokenExitType.MAXIMIZE_FEE_WITHDRAWAL) {
            uint256 freeFAsset = subOrZero(virtualFAsset, debtFAsset);
            freeFAssetFeeShare = Math.min(fAssetShare, freeFAsset);
            debtFAssetFeeShare = fAssetShare - freeFAssetFeeShare;
        } else if (_exitType == TokenExitType.MINIMIZE_FEE_DEBT) {
            debtFAssetFeeShare = Math.min(fAssetShare, debtFAsset);
            freeFAssetFeeShare = fAssetShare - debtFAssetFeeShare;
        } else { // KEEP_RATIO
            debtFAssetFeeShare = virtualFAsset > 0 ? debtFAsset.mulDiv(fAssetShare, virtualFAsset) : 0;
            // _tokenShare <= token.balanceOf(_account) implies fAssetShare <= virtualFAsset
            // implies debtFAssetFeeShare <= fAssetShare
            freeFAssetFeeShare = fAssetShare - debtFAssetFeeShare;
        }
        // cap the fee shares in case of rounding errors
        freeFAssetFeeShare = Math.min(freeFAssetFeeShare, totalFAssetFees);
        debtFAssetFeeShare = Math.min(debtFAssetFeeShare, totalFAssetFeeDebt);
    }

    function _getFAssetRequiredToNotSpoilCR(
        AssetData memory _assetData,
        uint256 _natShare
    )
        internal view
        returns (uint256)
    {
        // calculate f-assets required for CR to stay above min(exitCR, poolCR) when taking out _natShare
        // if pool is below exitCR, we shouldn't require it be increased above exitCR, only preserved
        // if pool is above exitCR, we require only for it to stay that way (like in the normal exit)
        if (_staysAboveCR(_assetData, 0, exitCollateralRatioBIPS)) {
            // f-asset required for CR to stay above exitCR (might not be needed)
            // solve (N - n) / (p / q (F - f)) >= cr get f = max(0, F - q (N - n) / (p cr))
            return subOrZero(_assetData.agentBackedFAsset, _assetData.assetPriceDiv *
                (_assetData.poolNatBalance - _natShare) * SafePct.MAX_BIPS /
                (_assetData.assetPriceMul * exitCollateralRatioBIPS)
            ); // _assetPriceMul > 0, exitCR > 1
        } else {
            // f-asset that preserves pool CR (assume poolNatBalance >= natShare > 0)
            // solve (N - n) / (F - f) = N / F get n = N f / F
            return _assetData.agentBackedFAsset.mulDiv(_natShare, _assetData.poolNatBalance);
        }
    }

    function _getNatRequiredToNotSpoilCR(
        AssetData memory _assetData,
        uint256 _fAssetShare
    )
        internal view
        returns (uint256)
    {
        // calculate nat required to keep CR above min(exitCR, poolCR) when taking out _fAssetShare
        // if pool is below exitCR, we shouldn't require it be increased above exitCR, only preserved
        // if pool is above exitCR, we require only for it to stay that way (like in the normal exit)
        if (_staysAboveCR(_assetData, 0, exitCollateralRatioBIPS)) {
            // nat required for CR to stay above exitCR (might not be needed)
            // solve (N - n) / (p / q (F - f)) >= cr get n = max(0, N - p (F - f) cr / q)
            return subOrZero(_assetData.poolNatBalance,
                (_assetData.assetPriceMul * (_assetData.agentBackedFAsset - _fAssetShare))
                .mulBips(exitCollateralRatioBIPS) / _assetData.assetPriceDiv
            );
        } else {
            // nat that preserves pool CR (agentBackedFAsset > 0 otherwise else path not taken)
            // solve (N - n) / (F - f) = N / F get n = N f / F
            return _assetData.poolNatBalance.mulDiv(_fAssetShare, _assetData.agentBackedFAsset);
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
        // check (N - n) / (F p / q) >= cr get (N - n) q >= F p cr
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
        if (tokens == 0) return 0;
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
        // this can happen only when user has no free f-assets (that is why subOrZero)
        // note: rounding errors can make freeFassets larger than total pool f-asset fees by small amounts
        // (that is why Math.min)
        return Math.min(subOrZero(virtualFAssetFees, debtFAssetFees), totalFAssetFees);
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
        uint256 virtualFassets = _assetData.poolVirtualFAssetFees.mulDiv(tokens, _assetData.poolTokenSupply);
        uint256 freeFassets = subOrZero(virtualFassets, debtFassets);
        return _assetData.poolTokenSupply.mulDiv(freeFassets, _assetData.poolVirtualFAssetFees);
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

    function _mintFAssetFeeDebt(address _account, uint256 _fAssets)
        internal
    {
        _fAssetFeeDebtOf[_account] += _fAssets;
        totalFAssetFeeDebt += _fAssets;
    }

    // _fAssets should be smaller or equal to _account's f-asset debt
    function _burnFAssetFeeDebt(address _account, uint256 _fAssets)
        internal
    {
        _fAssetFeeDebtOf[_account] -= _fAssets;
        totalFAssetFeeDebt -= _fAssets;
    }

    function _transferFAsset(
        address _from,
        address _to,
        uint256 _amount
    )
        internal
    {
        if (_amount > 0) {
            if (_from == address(this)) {
                totalFAssetFees -= _amount;
                fAsset.safeTransfer(_to, _amount);
            } else { // if (_to == address(this)) {
                /* solhint-disable reentrancy */
                totalFAssetFees += _amount;
                fAsset.safeTransferFrom(_from, _to, _amount);
            }
        }
    }

    function _transferWNat(
        address _to,
        uint256 _amount
    )
        internal
    {
        if (_amount > 0) {
            totalCollateral -= _amount;
            wNat.safeTransfer(_to, _amount);
        }
    }

    function _depositWNat()
        internal
    {
        // msg.value is always > 0 in this contract
        if (msg.value > 0) {
            totalCollateral += msg.value;
            wNat.deposit{value: msg.value}();
        }
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
        external view override
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return subOrZero(token.balanceOf(_account), _transferableTokensOf(assetData, _account));
    }

    /**
     * @notice Returns user's free tokens
     * @param _account  User address
     */
    function transferableTokensOf(address _account)
        external view override
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
        nonReentrant
    {
        require(token.totalSupply() == 0, "cannot destroy a pool with issued tokens");
        require(totalCollateral == 0, "cannot destroy a pool holding collateral");
        require(totalFAssetFees == 0, "cannot destroy a pool holding f-assets");
        token.destroy(_recipient);
        // transfer native balance, if any (used to be done by selfdestruct)
        _transferNAT(_recipient, address(this).balance);
        // transfer untracked f-assets and wNat, if any
        uint256 untrackedWNat = wNat.balanceOf(address(this));
        uint256 untrackedFAsset = fAsset.balanceOf(address(this));
        if (untrackedWNat > 0) {
            wNat.safeTransfer(_recipient, untrackedWNat);
        }
        if (untrackedFAsset > 0) {
            fAsset.safeTransfer(_recipient, untrackedFAsset);
        }
    }

    // slither-disable-next-line reentrancy-eth         // guarded by nonReentrant
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
        _transferWNat(_recipient, _amount);
        // slash agent vault's pool tokens worth _agentResponsibilityWei in FLR (or less if there is not enough)
        uint256 agentTokenBalance = token.balanceOf(agentVault);
        uint256 toSlashTokenMax = assetData.poolNatBalance > 0 ?
             assetData.poolTokenSupply.mulDiv(_agentResponsibilityWei, assetData.poolNatBalance) : agentTokenBalance;
        uint256 toSlashToken = Math.min(toSlashTokenMax, agentTokenBalance);
        if (toSlashToken > 0) {
            (uint256 debtFAssetFeeShare,) = _getDebtAndFreeFAssetFeesFromTokenShare(
                assetData, agentVault, toSlashToken, TokenExitType.KEEP_RATIO);
            _burnFAssetFeeDebt(agentVault, debtFAssetFeeShare);
            token.burn(agentVault, toSlashToken);
        }
    }

    // slither-disable-next-line reentrancy-eth         // guarded by nonReentrant
    function upgradeWNatContract(IWNat _newWNat)
        external override
        onlyAssetManager
        nonReentrant
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
        assetManager.updateCollateral(agentVault, wNat);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Delegation of the pool's collateral and airdrop claiming (same as in AgentVault)

    function delegate(
        address[] memory _to,
        uint256[] memory _bips
    )
        external override
        onlyAgent
    {
        wNat.batchDelegate(_to, _bips);
    }

    function undelegateAll() external onlyAgent {
        wNat.undelegateAll();
    }

    function revokeDelegationAt(address _who, uint256 _blockNumber) external onlyAgent {
        wNat.revokeDelegationAt(_who, _blockNumber);
    }

    function delegateGovernance(address _to) external onlyAgent {
        wNat.governanceVotePower().delegate(_to);
    }

    function undelegateGovernance() external onlyAgent {
        wNat.governanceVotePower().undelegate();
    }

    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager,
        uint256 _lastRewardEpoch
    )
        external override
        onlyAgent
        returns (uint256)
    {
        uint256 claimed = _ftsoRewardManager.claim(address(this), payable(address(this)), _lastRewardEpoch, true);
        totalCollateral += claimed;
        return claimed;
    }

    function claimAirdropDistribution(
        IDistributionToDelegators _distribution,
        uint256 _month
    )
        external override
        onlyAgent
        returns(uint256)
    {
        uint256 claimed = _distribution.claim(address(this), payable(address(this)), _month, true);
        totalCollateral += claimed;
        return claimed;
    }

    // Set executors that can then automatically claim rewards and airdrop.
    function setAutoClaiming(
        IClaimSetupManager _claimSetupManager,
        address[] memory _executors
    )
        external payable override
        onlyAgent
    {
        _claimSetupManager.setAutoClaiming{value: msg.value}(_executors, false);
        // no recipients setup - claim everything to pool
    }

    function optOutOfAirdrop(
        IDistributionToDelegators _distribution
    )
        external override
        onlyAgent
    {
        _distribution.optOutOfAirdrop();
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // The rest

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
        _transferWNat(msg.sender, natShare);
    }

    function _transferNAT(address payable _recipient, uint256 _amount) private {
        if (_amount > 0) {
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = _recipient.call{value: _amount}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, "transfer failed");
        }
    }

    /**
     * Implementation of ERC-165 interface.
     */
    function supportsInterface(bytes4 _interfaceId)
        external pure override
        returns (bool)
    {
        return _interfaceId == type(IERC165).interfaceId
            || _interfaceId == type(IContingencyPool).interfaceId
            || _interfaceId == type(IIContingencyPool).interfaceId;
    }

    function subOrZero(uint256 _a, uint256 _b)
        private pure
        returns (uint256)
    {
        return _a > _b ? _a - _b : 0;
    }
}
