// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../utils/lib/SafePct.sol";
import "../interface/IWNat.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAgentVault.sol";
import "../interface/ICollateralPool.sol";
import "./CollateralPoolToken.sol";

contract CollateralPool is ICollateralPool, ReentrancyGuard {

    using SafePct for uint256;

    uint256 public constant MINIMUM_ENTER_AMOUNT = 1e18; // 1 FLR
    uint256 public constant CLAIM_FTSO_REWARDS_INTEREST_BIPS = 300;
    uint256 internal constant MAX_NAT_TO_POOL_TOKEN_RATIO = 1000;

    address public immutable agentVault;
    address public immutable agentVaultOwner;
    IAssetManager public immutable assetManager;
    IERC20 public immutable fAsset;
    IWNat public wNat;
    CollateralPoolToken private token;
    uint32 public exitCRBIPS;
    uint32 public topupCRBIPS;
    uint16 public topupTokenDiscountBIPS;
    bool private internalWithdrawal;

    mapping(address => uint256) private _fassetDebtOf;
    uint256 public poolFassetDebt;

    modifier onlyAssetManager {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
    }

    modifier onlyAgent {
        require(msg.sender == agentVaultOwner);
        _;
    }

    constructor (
        address _agentVault,
        address _assetManager,
        address _fAsset,
        uint32 _exitCRBIPS,
        uint32 _topupCRBIPS,
        uint16 _topupTokenDiscountBIPS
    ) {
        agentVault = _agentVault;
        agentVaultOwner = IAgentVault(agentVault).owner();
        assetManager = IAssetManager(_assetManager);
        fAsset = IERC20(_fAsset);
        wNat = assetManager.getWNat();
        exitCRBIPS = _exitCRBIPS;
        topupCRBIPS = _topupCRBIPS;
        topupTokenDiscountBIPS = _topupTokenDiscountBIPS;
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

    function enter(uint256 _fassets, bool _enterWithFullFassets)
        external payable
    {
        AssetData memory assetData = _getAssetData();
        require(assetData.poolTokenSupply <= assetData.poolNatBalance * MAX_NAT_TO_POOL_TOKEN_RATIO,
            "nat balance too small");
        require(msg.value >= MINIMUM_ENTER_AMOUNT, "amount of nat sent is too low");
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

    // check that after exit there remain either 0 or some large enough amount of collateral
    function exit(uint256 _tokenShare, TokenExitType _exitType)
        external override
        returns (uint256, uint256)
    {
        require(_tokenShare > 0, "token share is zero");
        require(_tokenShare <= token.balanceOf(msg.sender), "token balance too low");
        AssetData memory assetData = _getAssetData();
        // poolTokenSupply >= _tokenShare > 0
        uint256 natShare = _tokenShare.mulDiv(assetData.poolNatBalance, assetData.poolTokenSupply);
        require(natShare > 0, "amount of sent tokens is too small");
        require(_isAboveCR(assetData.poolNatBalance - natShare, assetData.fassetSupply, exitCRBIPS),
            "collateral ratio falls below exitCR");
        (uint256 debtFassetShare, uint256 freeFassetShare) = _getFassetSharesFromTokenShare(
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

    // requires the amount of fassets that doesn't lower pool CR
    function selfCloseExit(
        uint256 _tokenShare,
        bool _redeemToCollateral,
        TokenExitType _exitType,
        string memory _redeemerUnderlyingAddressString
    )
        external
    {
        require(_tokenShare > 0, "token share is zero");
        require(_tokenShare <= token.balanceOf(msg.sender), "token balance too low");
        AssetData memory assetData = _getAssetData();
        uint256 natShare = assetData.poolNatBalance.mulDiv(
            _tokenShare, assetData.poolTokenSupply); // poolTokenSupply >= _tokenShare > 0
        require(natShare > 0, "amount of sent tokens is too small");
        (uint256 debtFassetShare, uint256 freeFassetShare) = _getFassetSharesFromTokenShare(
            msg.sender, _tokenShare, _exitType, assetData);
        uint256 fassetsRequiredToKeepCR = assetData.fassetSupply.mulDiv(
            natShare, assetData.poolNatBalance); // poolNatBalance >= natShare > 0
        uint256 additionallyRequiredFassets = 0;
        if (freeFassetShare < fassetsRequiredToKeepCR) {
            additionallyRequiredFassets = fassetsRequiredToKeepCR - freeFassetShare;
            require(fAsset.allowance(msg.sender, address(this)) >= additionallyRequiredFassets,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), additionallyRequiredFassets);
        }
        // agent redemption
        uint256 fassetsToRedeem = freeFassetShare + additionallyRequiredFassets;
        if (fassetsToRedeem > 0) {
            if (fassetsToRedeem < assetManager.getLotSize() || _redeemToCollateral) {
                assetManager.redeemFromAgentInCollateral(
                    agentVault, msg.sender, fassetsToRedeem);
            } else {
                assetManager.redeemFromAgent(
                    agentVault, msg.sender, fassetsToRedeem, _redeemerUnderlyingAddressString);
            }
        }
        // transfer/burn assets
        _burnFassetDebt(msg.sender, debtFassetShare);
        wNat.transfer(msg.sender, natShare);
        token.burn(msg.sender, _tokenShare);
    }

    // used to collect fasset fees, at expanse of locking additional free tokens
    function withdrawFees(uint256 _fassets)
        external
    {
        if (_fassets > 0) {
            AssetData memory assetData = _getAssetData();
            uint256 freeFassetShare = _virtualFassetOf(msg.sender, assetData) - _fassetDebtOf[msg.sender];
            require(_fassets <= freeFassetShare, "free f-asset balance too small");
            _mintFassetDebt(msg.sender, _fassets);
            fAsset.transfer(msg.sender, _fassets);
        }
    }

    // used to pay off debt and unlock the debt tokens
    function payFeeDebt(uint256 _fassets)
        external
    {
        uint256 paid = Math.min(_fassetDebtOf[msg.sender], _fassets);
        if (paid > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= paid,
                "f-asset allowance too small");
            _burnFassetDebt(msg.sender, paid);
            fAsset.transferFrom(msg.sender, address(this), paid);
        }
    }

    function poolToken() external view override returns (IERC20) {
        return token;
    }

    function _mintFassetDebt(address _account, uint256 _fassets)
        internal
    {
        _fassetDebtOf[_account] += _fassets;
        poolFassetDebt += _fassets;
    }
    function _burnFassetDebt(address _account, uint256 _fassets)
        internal
    {
        _fassetDebtOf[_account] -= _fassets;
        poolFassetDebt -= _fassets;
    }

    // method calculating tokens bought with collateral, taking into account the topup discount
    function _collateralToTokenShare(
        uint256 _collateral, AssetData memory _assetData
    )
        internal view
        returns (uint256)
    {
        uint256 topupTokenBonusBIPS = uint256(10_000).mulDiv(10_000, topupTokenDiscountBIPS);
        bool poolConsideredEmpty = _assetData.poolNatBalance == 0 || _assetData.poolTokenSupply == 0;
        // calculate nat share to be priced with topup discount and nat share to be priced standardly
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        uint256 _aux = (assetPriceMul * _assetData.fassetSupply).mulBips(topupCRBIPS);
        uint256 natRequiredToTopup = _aux > _assetData.poolNatBalance * assetPriceDiv ?
            _aux / assetPriceDiv - _assetData.poolNatBalance : 0;
        uint256 collateralForTopupPricing = Math.min(_collateral, natRequiredToTopup);
        uint256 collateralAtStandardPrice = collateralForTopupPricing < _collateral ?
            _collateral - collateralForTopupPricing : 0;
        uint256 collateralAtTopupPrice = collateralForTopupPricing.mulBips(topupTokenBonusBIPS);
        uint256 tokenShareAtStandardPrice = poolConsideredEmpty ?
            collateralAtStandardPrice : _assetData.poolTokenSupply.mulDiv(
                collateralAtStandardPrice, _assetData.poolNatBalance);
        uint256 tokenShareAtTopupPrice = poolConsideredEmpty ?
            collateralAtTopupPrice : _assetData.poolTokenSupply.mulDiv(
                collateralAtTopupPrice, _assetData.poolNatBalance);
        return tokenShareAtTopupPrice + tokenShareAtStandardPrice;
    }

    function _getFassetSharesFromTokenShare(
        address _account, uint256 _tokenShare, TokenExitType _exitType,
        AssetData memory _assetData
    )
        internal view
        returns (uint256, uint256)
    {
        uint256 debtTokenShare;
        uint256 freeTokenShare;
        if (_exitType == TokenExitType.WITHDRAW_MOST_FEES) {
            uint256 freeTokens = _freeTokensOf(_account, _assetData);
            freeTokenShare = Math.min(_tokenShare, freeTokens);
            debtTokenShare = freeTokenShare < _tokenShare ? _tokenShare - freeTokenShare : 0;
        } else if (_exitType == TokenExitType.MINIMIZE_FEE_DEBT) {
            uint256 debtTokens = _debtTokensOf(_account, _assetData);
            debtTokenShare = Math.min(_tokenShare, debtTokens);
            freeTokenShare = debtTokenShare < _tokenShare ? _tokenShare - debtTokenShare : 0;
        } else { // KEEP_RATIO
            uint256 debtTokens = _debtTokensOf(_account, _assetData);
            uint256 freeTokens = _freeTokensOf(_account, _assetData);
            uint256 tokens = debtTokens + freeTokens;
            debtTokenShare = debtTokens > 0 ? _tokenShare.mulDiv(debtTokens, tokens) : 0;
            freeTokenShare = freeTokens > 0 ? _tokenShare.mulDiv(freeTokens, tokens) : 0;
        }
        uint256 freeFassetShare = _assetData.poolVirtualFassetBalance.mulDiv(
            freeTokenShare, _assetData.poolTokenSupply);
        uint256 debtFassetShare = _assetData.poolVirtualFassetBalance.mulDiv(
            debtTokenShare, _assetData.poolTokenSupply);
        return (debtFassetShare, freeFassetShare);
    }

    function _isAboveCR(uint256 _poolBalanceNat, uint256 _fassetSupply, uint256 _crBIPS)
        internal view
        returns (bool)
    {
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        return _poolBalanceNat * assetPriceDiv >= (_fassetSupply * assetPriceMul).mulBips(_crBIPS);
    }

    function _virtualFassetOf(address _account, AssetData memory _assetData)
        internal view
        returns (uint256)
    {
        uint256 tokens = token.balanceOf(_account);
        return _assetData.poolVirtualFassetBalance.mulDiv(
            tokens, _assetData.poolTokenSupply);
    }

    function _debtTokensOf(address _account, AssetData memory _assetData)
        internal view
        returns (uint256)
    {
        return token.balanceOf(_account) - _freeTokensOf(_account, _assetData);
    }

    // note: integer operations round down the free tokens,
    // so the user can get slightly less tokens than those he owns mathematically
    // (we could also calculate free tokens as tokens - debtTokens)
    function _freeTokensOf(address _account, AssetData memory _assetData)
        internal view
        returns (uint256)
    {
        uint256 tokens = token.balanceOf(_account);
        if (tokens == 0) return 0; // prevents poolTokenSupply = 0
        uint256 debtFassets = _fassetDebtOf[_account];
        if (debtFassets == 0) return tokens; // prevents poolVirtualFassetBalance = 0
        uint256 requiredFassets = _assetData.poolVirtualFassetBalance.mulDiv(
            tokens, _assetData.poolTokenSupply);
        uint256 freeFassetShare = requiredFassets - debtFassets;
        uint256 freeTokens = _assetData.poolTokenSupply.mulDiv(
            freeFassetShare, _assetData.poolVirtualFassetBalance);
        return freeTokens;
    }

    function _getAssetData()
        internal view
        returns (AssetData memory)
    {
        uint256 poolFassetBalance = fAsset.balanceOf(address(this));
        return AssetData({
            poolTokenSupply: token.totalSupply(),
            fassetSupply: fAsset.totalSupply(),
            poolNatBalance: wNat.balanceOf(address(this)),
            poolFassetBalance: poolFassetBalance,
            poolVirtualFassetBalance: poolFassetBalance + poolFassetDebt
        });
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // methods for viewing user balances

    function fassetDebtOf(address _account)
        external view
        returns (uint256)
    {
        return _fassetDebtOf[_account];
    }

    function virtualFassetOf(address _account)
        external view
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return _virtualFassetOf(_account, assetData);
    }

    function debtTokensOf(address _account)
        external view
        returns (uint256)
    {
        AssetData memory assetData = _getAssetData();
        return _debtTokensOf(_account, assetData);
    }

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
        uint256 poolFassetBalance = fAsset.balanceOf(address(this));
        if (poolBalanceNat == 0 && poolFassetBalance == 0) {
            token.destroy(_recipient);
            selfdestruct(_recipient);
        }
    }

    // used by AssetManager to handle liquidation
    function payout(
        address _recipient,
        uint256 _amount,
        uint256 /* _agentResponsibilityWei */
    )
        external override
        onlyAssetManager
        nonReentrant
    {
        wNat.transfer(_recipient, _amount);
        // TODO: slash agent vault's pool tokens worth _agentResponsibilityWei in FLR
        //       (or less if there is not enough)
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

}
