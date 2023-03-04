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

contract CollateralPool is ReentrancyGuard {

    using SafePct for uint256;

    enum TokenExitType { PRIORITIZE_DEBT, PRIORITIZE_FASSET, KEEP_RATIO }
    TokenExitType public tokenExitType;

    struct AssetData {
        uint256 poolTokenSupply;
        uint256 fassetSupply;
        uint256 poolNatBalance;
        uint256 poolFassetBalance;
        uint256 poolVirtualFassetBalance;
    }

    uint256 public constant MINIMUM_ENTER_AMOUNT = 1e18; // 1 FLR
    uint256 public constant CLAIM_FTSO_REWARDS_INTEREST_BIPS = 300;
    uint256 internal constant MAX_NAT_TO_POOL_TOKEN_RATIO = 1000;

    address payable public immutable agentVault;
    IAssetManager public immutable assetManager;
    IERC20 public immutable fAsset;
    CollateralPoolToken public poolToken;
    uint32 public exitCRBIPS;
    uint32 public topupCRBIPS;
    uint16 public topupTokenDiscountBIPS;

    mapping(address => uint256) private _fassetDebtOf;
    uint256 public poolFassetDebt;

    modifier onlyAssetManager {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
    }

    modifier onlyAgent {
        require(msg.sender == address(agentVault), "only agent");
        _;
    }

    constructor (
        address payable _agentVault, address _assetManager, address _fAsset,
        uint32 _exitCRBIPS, uint32 _topupCRBIPS, uint16 _topupTokenDiscountBIPS
    ) {
        agentVault = _agentVault;
        assetManager = IAssetManager(_assetManager);
        fAsset = IERC20(_fAsset);
        exitCRBIPS = _exitCRBIPS;
        topupCRBIPS = _topupCRBIPS;
        topupTokenDiscountBIPS = _topupTokenDiscountBIPS;
    }

    function setPoolToken(address _poolToken)
        external
        onlyAgent
    {
        require(address(poolToken) == address(0), "pool token already set");
        poolToken = CollateralPoolToken(_poolToken);
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
        assetManager.getWNat().deposit{value: msg.value}();
        poolToken.mint(msg.sender, tokenShare);
    }

    // check that after exit there remain either 0 or some large enough amount of collateral
    function exit(uint256 _tokenShare, TokenExitType _exitType)
        public
    {
        require(_tokenShare > 0, "token share is zero");
        require(_tokenShare <= poolToken.balanceOf(msg.sender), "token balance too low");
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
        poolToken.burn(msg.sender, _tokenShare);
        assetManager.getWNat().transfer(msg.sender, natShare);
    }

    // requires the amount of fassets that doesn't lower pool CR
    function selfCloseExit(
        uint256 _tokenShare, bool _redeemToCollateral, TokenExitType _exitType,
        string memory _redeemerUnderlyingAddressString
    )
        public
    {
        require(_tokenShare > 0, "token share is zero");
        require(_tokenShare <= poolToken.balanceOf(msg.sender), "token balance too low");
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
        uint256 redeemedFassets = freeFassetShare + additionallyRequiredFassets;
        if (redeemedFassets > 0) {
            uint256 lotSizeUBA = assetManager.getLotSize();
            uint256 lotsToRedeem = redeemedFassets / lotSizeUBA;
            if (lotsToRedeem == 0 || _redeemToCollateral) {
                assetManager.redeemChosenAgentCollateral(
                    agentVault, redeemedFassets, msg.sender);
            } else {
                assetManager.redeemChosenAgentUnderlying(
                    agentVault, redeemedFassets, _redeemerUnderlyingAddressString);
            }
        }
        // transfer/burn assets
        _burnFassetDebt(msg.sender, debtFassetShare);
        assetManager.getWNat().transfer(msg.sender, natShare);
        poolToken.burn(msg.sender, _tokenShare);
    }

    // used to collect fasset fees, at expanse of locking additional free tokens
    function mintFassetDebt(uint256 _fassets)
        public
    {
        AssetData memory assetData = _getAssetData();
        uint256 freeFassetShare = _virtualFassetOf(msg.sender, assetData) - _fassetDebtOf[msg.sender];
        require(_fassets <= freeFassetShare, "free f-asset balance too small");
        if (_fassets > 0) {
            _mintFassetDebt(msg.sender, _fassets);
            fAsset.transfer(msg.sender, _fassets);
        }
    }

    // used to payoff debt and unlock the debt tokens
    function burnFassetDebt(uint256 _fassets)
        public
    {
        uint256 paid = Math.min(_fassetDebtOf[msg.sender], _fassets);
        if (paid > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= paid,
                "f-asset allowance too small");
            _burnFassetDebt(msg.sender, paid);
            fAsset.transferFrom(msg.sender, address(this), paid);
        }
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
    function _collateralToTokenShare(uint256 _collateral, AssetData memory _assetData)
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
        internal view returns (uint256, uint256)
    {
        uint256 debtTokenShare;
        uint256 freeTokenShare;
        if (_exitType == TokenExitType.PRIORITIZE_DEBT) {
            uint256 debtTokens = _debtTokensOf(_account, _assetData);
            debtTokenShare = Math.min(_tokenShare, debtTokens);
            freeTokenShare = debtTokenShare < _tokenShare ? _tokenShare - debtTokenShare : 0;
        } else if (_exitType == TokenExitType.PRIORITIZE_FASSET) {
            uint256 freeTokens = _freeTokensOf(_account, _assetData);
            freeTokenShare = Math.min(_tokenShare, freeTokens);
            debtTokenShare = freeTokenShare < _tokenShare ? _tokenShare - freeTokenShare : 0;
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
        uint256 tokens = poolToken.balanceOf(_account);
        return _assetData.poolVirtualFassetBalance.mulDiv(
            tokens, _assetData.poolTokenSupply);
    }

    function _debtTokensOf(address _account, AssetData memory _assetData)
        internal view
        returns (uint256)
    {
        return poolToken.balanceOf(_account) - _freeTokensOf(_account, _assetData);
    }

    // note: integer operations round down the free tokens,
    // so the user can get slightly less tokens than those he owns mathematically
    // (we could also calculate free tokens as tokens - debtTokens)
    function _freeTokensOf(address _account, AssetData memory _assetData)
        internal view
        returns (uint256)
    {
        uint256 tokens = poolToken.balanceOf(_account);
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
            poolTokenSupply: poolToken.totalSupply(),
            fassetSupply: fAsset.totalSupply(),
            poolNatBalance: assetManager.getWNat().balanceOf(address(this)),
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
        IWNat wnat = assetManager.getWNat();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        uint256 poolFassetBalance = fAsset.balanceOf(address(this));
        if (poolBalanceNat == 0 && poolFassetBalance == 0) {
            poolToken.destroy();
            selfdestruct(_recipient);
        }
    }

    // used by AssetManager to handle liquidation
    function payout(
        address _recipient,
        uint256 _amount
    )
        external
        onlyAssetManager
        nonReentrant
    {
        IWNat wnat = assetManager.getWNat();
        wnat.transfer(_recipient, _amount);
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
        return _distribution.claim(address(this), _month);
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
        IVPToken wnat = IVPToken(assetManager.getWNat());
        wnat.batchDelegate(_to, _bips);
    }

    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager,
        uint256 _lastRewardEpoch
    )
        external
        nonReentrant
    {
        uint256 ftsoRewards = _ftsoRewardManager.claim(
            address(this), payable(address(this)), _lastRewardEpoch, false
        );
        uint256 callerReward = ftsoRewards.mulBips(CLAIM_FTSO_REWARDS_INTEREST_BIPS);
        if (callerReward > 0) {
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = msg.sender.call{value: callerReward}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, "transfer failed");
        }
    }

    // Set executors and recipients that can then automatically claim rewards through FtsoRewardManager.
    function setFtsoAutoClaiming(
        IClaimSetupManager _claimSetupManager,
        address[] memory _executors,
        address[] memory _allowedRecipients
    )
        external payable
        onlyAgent
    {
        _claimSetupManager.setClaimExecutors{value: msg.value}(_executors);
        _claimSetupManager.setAllowedClaimRecipients(_allowedRecipients);
    }

}
