// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../utils/lib/SafePct.sol";
import "../interface/IWNat.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAgentVault.sol";
import "../interface/ICollateralPool.sol";
import "../interface/IFAsset.sol";
import "./CollateralPoolToken.sol";

contract CollateralPool is ICollateralPool, ReentrancyGuard {
    using SafeCast for uint256;
    using SafePct for uint256;

    struct AssetData {
        uint256 poolTokenSupply;
        uint256 backedFAssets;
        uint256 poolNatBalance;
        uint256 poolFassetBalance;
        uint256 poolVirtualFassetBalance;
        uint256 assetPriceMul;
        uint256 assetPriceDiv;
    }

    uint256 internal constant MAX_NAT_TO_POOL_TOKEN_RATIO = 1000;
    uint256 public constant MIN_NAT_TO_ENTER = 1 ether;
    uint256 public constant MIN_TOKEN_SUPPLY_AFTER_EXIT = 1 ether;
    uint256 public constant MIN_NAT_BALANCE_AFTER_EXIT = 1 ether;

    address public immutable agentVault;
    IAssetManager public immutable assetManager;
    IFAsset public immutable fAsset;
    CollateralPoolToken public token; // practically immutable

    IWNat public wNat;
    uint32 public exitCollateralRatioBIPS;
    uint32 public topupCollateralRatioBIPS;
    uint16 public topupTokenPriceFactorBIPS;
    bool private internalWithdrawal;

    mapping(address => uint256) private _fassetDebtOf;
    uint256 public poolFassetDebt;

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
        assetManager = IAssetManager(_assetManager);
        fAsset = IFAsset(_fAsset);
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
        token = CollateralPoolToken(_poolToken);
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
     * @param _fassets                 Number of f-assets sent along the deposited NAT (not all may be used)
     * @param _enterWithFullFassets    Specifies whether "required" f-assets should be calculated automatically
     */
    function enter(uint256 _fassets, bool _enterWithFullFassets)
        external payable
    {
        AssetData memory assetData = _getAssetData();
        require(assetData.poolTokenSupply <= assetData.poolNatBalance * MAX_NAT_TO_POOL_TOKEN_RATIO,
            "pool nat balance too small");
        require(msg.value >= MIN_NAT_TO_ENTER, "amount of nat sent is too low");
        if (assetData.poolTokenSupply == 0) {
            require(msg.value >= assetData.poolNatBalance,
                "if pool has no tokens, but has collateral, you need to send at least that amount of collateral");
        }
        // calculate obtained pool tokens and free fassets
        uint256 tokenShare = _collateralToTokenShare(msg.value, assetData);
        uint256 fassetShare = assetData.poolTokenSupply == 0 ?
            0 : assetData.poolVirtualFassetBalance.mulDiv(tokenShare, assetData.poolTokenSupply);
        uint256 freeFassetShare = _enterWithFullFassets ? fassetShare : Math.min(_fassets, fassetShare);
        // transfer/mint calculated assets
        if (freeFassetShare > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= freeFassetShare,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), freeFassetShare);
        }
        _mintFassetDebt(msg.sender, fassetShare - freeFassetShare);
        wNat.deposit{value: msg.value}();
        token.mint(msg.sender, tokenShare);
    }

    /**
     * @notice Exits the pool by liquidating the given amount of pool tokens
     * @param _tokenShare   The amount of pool tokens to be liquidated
     *                      Must be positive and smaller or equal to the sender's token balance
     * @param _exitType     An enum describing the ratio used to liquidate debt and free tokens
     */
    function exit(uint256 _tokenShare, TokenExitType _exitType)
        external override
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
        (uint256 debtFassetShare, uint256 freeFassetShare) = _getDebtAndFreeFassetShareFromTokenShare(
            msg.sender, _tokenShare, _exitType, assetData);
        if (freeFassetShare > 0) {
            fAsset.transfer(msg.sender, freeFassetShare);
        }
        if (debtFassetShare > 0) {
            _burnFassetDebt(msg.sender, debtFassetShare);
        }
        token.burn(msg.sender, _tokenShare);
        wNat.transfer(msg.sender, natShare);
        return (natShare, freeFassetShare);
    }

    /**
     * @notice Exits the pool by liquidating the given amount of pool tokens and redeeming
     *  f-assets in a way that preserves or increases the pool collateral ratio
     * @param _tokenShare                   The amount of pool tokens to be liquidated
     *                                      Must be positive and smaller or equal to the sender's token balance
     * @param _exitType                     An enum describing the ratio used to liquidate debt and free tokens
     * @param _redeemToCollateral           Specifies if agent should redeem f-assets in NAT from his collateral
     * @param _redeemerUnderlyingAddress    Redeemer's address on the underlying chain
     * @notice F-assets can still be redeemed in collateral if their value does not exceed one lot
     */
    function selfCloseExit(
        uint256 _tokenShare,
        TokenExitType _exitType,
        bool _redeemToCollateral,
        string memory _redeemerUnderlyingAddress
    )
        external
    {
        require(_tokenShare > 0, "token share is zero");
        require(_tokenShare <= token.balanceOf(msg.sender), "token balance too low");
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
        (uint256 debtFassetShare, uint256 freeFassetShare) = _getDebtAndFreeFassetShareFromTokenShare(
            msg.sender, _tokenShare, _exitType, assetData);
        // calculate f-assets required to keep CR above min(exitCR, poolCR)
        // if pool is below exitCR we shouldn't require it be increased above exitCR, only preserved
        // if pool is above exitCR, we require only for it to stay that way (like in the normal exit)
        uint256 requiredFAssets;
        if (_staysAboveCR(assetData, 0, exitCollateralRatioBIPS)) {
            // f-assets required for CR to stay above exitCR (might not be needed)
            // If price is positive, we divide by a positive number as exitCollateralRatioBIPS >= 1
            uint256 _aux = assetData.assetPriceDiv * (assetData.poolNatBalance - natShare) /
                assetData.assetPriceMul.mulBips(exitCollateralRatioBIPS);
            requiredFAssets = assetData.backedFAssets > _aux ? assetData.backedFAssets - _aux : 0;
        } else {
            // f-assets that preserve CR
            requiredFAssets = assetData.backedFAssets.mulDiv(
                natShare, assetData.poolNatBalance); // poolNatBalance >= natShare > 0
        }
        // if required f-assets are larger than f-asset fees, calculate additionally required f-assets
        uint256 additionallyRequiredFAssets;
        if (freeFassetShare < requiredFAssets) {
            additionallyRequiredFAssets = requiredFAssets - freeFassetShare;
            require(fAsset.allowance(msg.sender, address(this)) >= additionallyRequiredFAssets,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), additionallyRequiredFAssets);
        }
        // agent redemption (note: fassetToRedeem can be larger than requiredFAssets)
        uint256 fassetsToRedeem = freeFassetShare + additionallyRequiredFAssets;
        if (fassetsToRedeem > 0) {
            if (fassetsToRedeem < assetManager.getLotSize() || _redeemToCollateral) {
                assetManager.redeemFromAgentInCollateral(
                    agentVault, msg.sender, fassetsToRedeem);
            } else {
                assetManager.redeemFromAgent(
                    agentVault, msg.sender, fassetsToRedeem, _redeemerUnderlyingAddress);
            }
        }
        // transfer/burn assets
        if (debtFassetShare > 0) {
            _burnFassetDebt(msg.sender, debtFassetShare);
        }
        wNat.transfer(msg.sender, natShare);
        token.burn(msg.sender, _tokenShare);
    }

    /**
     * @notice Collect f-asset fees by locking free tokens
     * @param _fassets  The amount of f-asset fees to withdraw
     *                  Must be positive and smaller or equal to the sender's reward f-assets
     */
    function withdrawFees(uint256 _fassets)
        external
    {
        require(_fassets > 0, "trying to withdraw zero f-assets");
        AssetData memory assetData = _getAssetData();
        uint256 freeFassetShare = _virtualFassetOf(msg.sender, assetData) - _fassetDebtOf[msg.sender];
        require(_fassets <= freeFassetShare, "free f-asset balance too small");
        _mintFassetDebt(msg.sender, _fassets);
        fAsset.transfer(msg.sender, _fassets);
    }

    /**
     * @notice Free debt tokens by paying f-assets
     * @param _fassets  Amount of payed f-assets
     *                  _fassets must be positive and smaller or equal to the sender's debt f-assets
     */
    function payFeeDebt(uint256 _fassets)
        external
    {
        require(_fassets <= _fassetDebtOf[msg.sender], "debt f-asset balance too small");
        require(fAsset.allowance(msg.sender, address(this)) >= _fassets,
            "f-asset allowance too small");
        _burnFassetDebt(msg.sender, _fassets);
        fAsset.transferFrom(msg.sender, address(this), _fassets);
    }

    /**
     * @notice Returns the collateral pool token contract used by this contract
     */
    function poolToken() external view override returns (IERC20) {
        return token;
    }

    function _mintFassetDebt(address _account, uint256 _fassets)
        internal
    {
        _fassetDebtOf[_account] += _fassets;
        poolFassetDebt += _fassets;
    }
    // _fassets should be smaller or equal to _account's f-asset debt
    function _burnFassetDebt(address _account, uint256 _fassets)
        internal
    {
        _fassetDebtOf[_account] -= _fassets;
        poolFassetDebt -= _fassets;
    }

    function _collateralToTokenShare(
        uint256 _collateral, AssetData memory _assetData
    )
        internal view
        returns (uint256)
    {
        bool poolConsideredEmpty = _assetData.poolNatBalance == 0 || _assetData.poolTokenSupply == 0;
        // calculate nat share to be priced with topup discount and nat share to be priced standardly
        uint256 _aux = (_assetData.assetPriceMul * _assetData.backedFAssets).mulBips(topupCollateralRatioBIPS);
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

    // _tokenShare should be smaller or equal to _account's token balance
    // Assumption is not checked explicitly,
    // if _exitType is MAXIMIZE_FEE_WITHDRAWAL or MINIMIZE_FEE_DEBT, then _tokenShare overflow
    // is treated as _tokenShare = token.balanceOf(_account), while on _exitType = KEEP_RATIO,
    // the function reverts as fassetShare - debtFassetShare < 0
    function _getDebtAndFreeFassetShareFromTokenShare(
        address _account, uint256 _tokenShare, TokenExitType _exitType,
        AssetData memory _assetData
    )
        internal view
        returns (uint256 debtFassetShare, uint256 freeFassetShare)
    {
        uint256 virtualFassetBalance = _virtualFassetOf(_account, _assetData);
        uint256 debtFasset = _fassetDebtOf[_account];
        uint256 fassetShare = virtualFassetBalance.mulDiv(_tokenShare, token.balanceOf(_account));
        if (_exitType == TokenExitType.MAXIMIZE_FEE_WITHDRAWAL) {
            uint256 freeFasset = virtualFassetBalance - debtFasset;
            freeFassetShare = Math.min(fassetShare, freeFasset);
            debtFassetShare = freeFassetShare < fassetShare ? fassetShare - freeFassetShare : 0;
        } else if (_exitType == TokenExitType.MINIMIZE_FEE_DEBT) {
            debtFassetShare = Math.min(fassetShare, debtFasset);
            freeFassetShare = debtFassetShare < fassetShare ? fassetShare - debtFassetShare : 0;
        } else { // KEEP_RATIO
            // debtFasset <= virtualFassetBalance
            debtFassetShare = debtFasset > 0 ? debtFasset.mulDiv(fassetShare, virtualFassetBalance) : 0;
            freeFassetShare = fassetShare - debtFassetShare;
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
            (_assetData.backedFAssets * _assetData.assetPriceMul).mulBips(_crBIPS);
    }

    function _getAssetData()
        internal view
        returns (AssetData memory)
    {
        uint256 poolFassetBalance = fAsset.balanceOf(address(this));
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        return AssetData({
            poolTokenSupply: token.totalSupply(),
            backedFAssets: assetManager.getFAssetsBackedByPool(address(agentVault)),
            poolNatBalance: wNat.balanceOf(address(this)),
            poolFassetBalance: poolFassetBalance,
            poolVirtualFassetBalance: poolFassetBalance + poolFassetDebt,
            assetPriceMul: assetPriceMul,
            assetPriceDiv: assetPriceDiv
        });
    }

    function _virtualFassetOf(address _account, AssetData memory _assetData)
        internal view
        returns (uint256)
    {
        uint256 tokens = token.balanceOf(_account);
        return _assetData.poolVirtualFassetBalance.mulDiv(
            tokens, _assetData.poolTokenSupply);
    }

    function _freeTokensOf(address _account, AssetData memory _assetData)
        internal view
        returns (uint256)
    {
        uint256 tokens = token.balanceOf(_account);
        if (tokens == 0) return 0; // prevents poolTokenSupply = 0
        uint256 debtFassets = _fassetDebtOf[_account];
        if (debtFassets == 0) return tokens; // prevents poolVirtualFassetBalance = 0
        uint256 virtualFassets = _assetData.poolVirtualFassetBalance.mulDiv(
            tokens, _assetData.poolTokenSupply);
        uint256 freeFassets = virtualFassets - debtFassets;
        uint256 freeTokens = _assetData.poolTokenSupply.mulDiv(
            freeFassets, _assetData.poolVirtualFassetBalance);
        return freeTokens;
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // methods for viewing user balances

    /**
     * @notice Returns the sum of the user's reward f-assets and their corresponding f-asset debt
     * @param _account  User address
     */
    function virtualFassetOf(address _account)
        external view
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return _virtualFassetOf(_account, assetData);
    }

    /**
     * @notice Returns user's reward f-assets
     * @param _account  User address
     */
    function freeFassetOf(address _account)
        external view
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return _virtualFassetOf(_account, assetData) - _fassetDebtOf[_account];
    }

    /**
     * @notice Returns user's f-asset debt
     * @param _account  User address
     */
    function fassetDebtOf(address _account)
        external view
        returns (uint256)
    {
        return _fassetDebtOf[_account];
    }

    /**
     * @notice Returns user's debt tokens
     * @param _account  User address
     */
    function debtTokensOf(address _account)
        external view
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return token.balanceOf(_account) - _freeTokensOf(_account, assetData);
    }

    /**
     * @notice Returns user's free tokens
     * @param _account  User address
     */
    function freeTokensOf(address _account)
        external view
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return _freeTokensOf(_account, assetData);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Methods to allow for liquidation/destruction of the pool by AssetManager or agent

    function destroy(address payable _recipient)
        external
        onlyAssetManager
    {
        uint256 poolBalanceNat = wNat.balanceOf(address(this));
        require(poolBalanceNat == 0, "cannot destroy a pool holding collateral");
        uint256 poolFassetBalance = fAsset.balanceOf(address(this));
        require(poolFassetBalance == 0, "cannot destroy a pool holding f-assets");
        token.destroy(_recipient);
        selfdestruct(_recipient);
    }

    // _agentResponsibilityWei should be less than agent vault balance
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
        wNat.transfer(_recipient, _amount);
        // slash agent vault's pool tokens worth _agentResponsibilityWei in FLR
        // (or less if there is not enough)
        uint256 agentVaultBalance = token.balanceOf(agentVault);
        uint256 toSlash = Math.min(agentVaultBalance, _agentResponsibilityWei);
        (uint256 debtFassetShare,) = _getDebtAndFreeFassetShareFromTokenShare(
            agentVault, toSlash, TokenExitType.KEEP_RATIO, assetData);
        _burnFassetDebt(agentVault, debtFassetShare);
        token.burn(agentVault, toSlash);
    }

    function upgradeWNatContract(IWNat _newWNat)
        external
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
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Delegation of the pool's collateral and airdrop claiming (same as in AgentVault)

    function claimAirdropDistribution(
        IDistributionToDelegators _distribution,
        uint256 _month
    )
        external
        onlyAgent
        returns(uint256)
    {
        return _distribution.claim(address(this), payable(address(this)), _month, true);
    }

    function optOutOfAirdrop(
        IDistributionToDelegators _distribution
    )
        external
        onlyAgent
    {
        _distribution.optOutOfAirdrop();
    }

    function delegateCollateral(
        address[] memory _to,
        uint256[] memory _bips
    )
        external
        onlyAgent
    {
        wNat.batchDelegate(_to, _bips);
    }

    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager,
        uint256 _lastRewardEpoch
    )
        external
        onlyAgent
    {
        _ftsoRewardManager.claim(address(this), payable(address(this)), _lastRewardEpoch, true);
    }

    // Set executors that can then automatically claim rewards through FtsoRewardManager.

    function setFtsoAutoClaiming(
        IClaimSetupManager _claimSetupManager,
        address[] memory _executors
    )
        external payable
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

    function withdrawCollateral()
        external
    {
        require(fAsset.terminatedAt != 0, "f-asset not terminated");
        uint256 tokens = token.balanceOf(msg.sender);
        require(tokens > 0, "nothing to withdraw");
        uint256 natShare = tokens.mulDiv(wNat.balanceOf(address(this)), token.totalSupply());
        wNat.transfer(msg.sender, natShare);
    }

}
