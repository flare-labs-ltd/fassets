// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../utils/lib/SafePct.sol";
import "../interface/IWNat.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAgentVault.sol";
import "./CollateralPoolToken.sol";

contract CollateralPool is ReentrancyGuard {

    using SafePct for uint256;

    struct AssetData {
        uint256 poolTokenSupply;
        uint256 fassetSupply;
        uint256 poolNatBalance;
        uint256 poolFassetBalance;
        uint256 poolVirtualFassetBalance;
    }

    uint256 public constant CLAIM_FTSO_REWARDS_INTEREST_BIPS = 300;
    uint256 internal constant MAX_NAT_TO_POOL_TOKEN_RATIO = 1000;

    address payable public immutable agentVault;
    IAssetManager public immutable assetManager;
    IERC20 public immutable fAsset;
    CollateralPoolToken public poolToken;
    uint256 public exitCRBIPS;
    uint256 public topupCRBIPS;
    uint256 public topupTokenDiscountBIPS;
    uint256 public topupTokenBonusBIPS;

    mapping(address => uint256) public _fassetDebtOf;
    uint256 public poolFassetDebt;

    modifier onlyAssetManager {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
    }

    modifier onlyAgent {
        require(msg.sender == address(agentVault));
        _;
    }

    constructor (
        address payable _agentVault, address _assetManager, address _fAsset,
        uint256 _exitCRBIPS, uint256 _topupCRBIPS, uint256 _topupTokenDiscountBIPS
    ) {
        agentVault = _agentVault;
        assetManager = IAssetManager(_assetManager);
        fAsset = IERC20(_fAsset);
        exitCRBIPS = _exitCRBIPS;
        topupCRBIPS = _topupCRBIPS;
        topupTokenDiscountBIPS = _topupTokenDiscountBIPS;
        topupTokenBonusBIPS = uint256(10_000).mulDiv(10_000, _topupTokenDiscountBIPS);
    }

    function setPoolToken(address _poolToken) external onlyAgent {
        if (address(poolToken) == address(0)) {
            poolToken = CollateralPoolToken(_poolToken);
        }
    }

    function enter(uint256 _fassets, bool _enterWithFullFassets) external payable {
        AssetData memory assetData = _getAssetData();
        require(assetData.poolTokenSupply <= assetData.poolNatBalance * MAX_NAT_TO_POOL_TOKEN_RATIO,
            "nat balance too small");
        // calculate obtained pool tokens and liquid fassets
        uint256 tokens = _collateralToTokenShare(msg.value);
        uint256 fassets = assetData.poolTokenSupply == 0 ?
            0 : assetData.poolVirtualFassetBalance.mulDiv(tokens, assetData.poolTokenSupply);
        uint256 liquidFassets = _enterWithFullFassets ? fassets : min(_fassets, fassets);
        // log msg.sender fasset debt
        uint256 debtFassets = fassets - liquidFassets;
        _fassetDebtOf[msg.sender] += debtFassets;
        poolFassetDebt += debtFassets;
        // transfer/mint calculated assets
        if (liquidFassets > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= liquidFassets,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), liquidFassets);
        }
        assetManager.getWNat().deposit{value: msg.value}();
        poolToken.mint(msg.sender, tokens);
    }

    // used to payoff debt and unlock the debt tokens
    function payoffDebt(uint256 _fassets, bool _payoffAllDebt) external {
        uint256 debt = _fassetDebtOf[msg.sender];
        require(_fassets <= debt, "debt is smaller than specified f-assets");
        uint256 paid = _payoffAllDebt ? debt : _fassets;
        if (paid > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= paid,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), paid);
            _fassetDebtOf[msg.sender] -= paid;
            poolFassetDebt -= paid;
        }
    }

    function fullExit() external {
        exit(liquidTokensOf(msg.sender));
    }

    function exit(uint256 _tokenShare) public {
        require(_tokenShare > 0, "token share is zero");
        AssetData memory assetData = _getAssetData();
        // poolTokenSupply >= _tokenShare > 0
        uint256 natShare = _tokenShare.mulDiv(assetData.poolNatBalance, assetData.poolTokenSupply);
        require(natShare > 0, "amount of supplied tokens is too small");
        // check whether the new collateral ratio is above exitCR
        uint256 updatedPoolBalanceNat = assetData.poolNatBalance - natShare;
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        require(updatedPoolBalanceNat * assetPriceDiv >= (assetData.fassetSupply * assetPriceMul).mulBips(exitCRBIPS),
            "collateral ratio falls below exitCR");
        // execute wnat transfer
        assetManager.getWNat().transfer(msg.sender, natShare);
        // execute fasset transfer
        uint256 fassetShare = assetData.poolVirtualFassetBalance.mulDiv(_tokenShare, assetData.poolTokenSupply);
        if (fassetShare > 0) {
            fAsset.transfer(msg.sender, fassetShare);
        }
        // execute token burn
        // note: "burn" also checks whether msg.sender had enough liquid
        // pool tokens to execute the exit (this is not checked beforehand)
        poolToken.burn(msg.sender, _tokenShare);
    }

    // requires the amount of fassets that doesn't lower pool CR
    // note: _tokenShare must represent liquid tokens
    function selfCloseExit(
        bool _redeemToCollateral, uint256 _tokenShare,
        string memory _redeemerUnderlyingAddressString
    ) public {
        require(_tokenShare > 0, "token share is zero");
        AssetData memory assetData = _getAssetData();
        // poolTokenSupply >= _tokenShare > 0
        uint256 natShare = assetData.poolNatBalance.mulDiv(_tokenShare, assetData.poolTokenSupply);
        require(natShare > 0, "amount of supplied tokens is too small");
        uint256 fassetShare = assetData.poolFassetBalance.mulDiv(
            _tokenShare, assetData.poolTokenSupply);
        // calculate msg.sender's additionally required fassets
        uint256 updatedPoolBalanceNat = assetData.poolNatBalance - natShare;
        uint256 updatedFassetSupply = assetData.fassetSupply - fassetShare;
        uint256 exemptionFassets = assetData.poolFassetBalance.mulDiv(
            updatedPoolBalanceNat, assetData.poolNatBalance);
        uint256 additionallyRequiredFassets = exemptionFassets <= updatedFassetSupply ?
            updatedFassetSupply - exemptionFassets : 0;
        if (additionallyRequiredFassets > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= additionallyRequiredFassets,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), additionallyRequiredFassets);
        }
        // execute asset transfer/burn
        assetManager.getWNat().transfer(msg.sender, natShare);
        poolToken.burn(msg.sender, _tokenShare);
        uint256 redeemedFassets = fassetShare + additionallyRequiredFassets;
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
    }

    // helper function for self-close exits paid with agent's collateral
    function selfCloseExitPaidWithCollateral(uint256 _tokenShare) external {
        selfCloseExit(true, _tokenShare, "");
    }

    // method calculating tokens bought with collateral, taking into account the topup discount
    function _collateralToTokenShare(uint256 _collateral) internal view returns (uint256) {
        AssetData memory assetData = _getAssetData();
        bool poolConsideredEmpty = assetData.poolNatBalance == 0 || assetData.poolTokenSupply == 0;
        // calculate nat share to be priced with topup discount and nat share to be priced standardly
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        uint256 _aux = (assetPriceMul * assetData.fassetSupply).mulBips(topupCRBIPS);
        uint256 natRequiredToTopup = _aux > assetData.poolNatBalance * assetPriceDiv ?
            _aux / assetPriceDiv - assetData.poolNatBalance : 0;
        uint256 collateralForTopupPricing = min(_collateral, natRequiredToTopup);
        uint256 collateralAtStandardPrice = collateralForTopupPricing < _collateral ?
            _collateral - collateralForTopupPricing : 0;
        uint256 collateralAtTopupPrice = collateralForTopupPricing.mulBips(topupTokenBonusBIPS);
        uint256 tokenShareAtStandardPrice = poolConsideredEmpty ?
            collateralAtStandardPrice : assetData.poolTokenSupply.mulDiv(
                collateralAtStandardPrice, assetData.poolNatBalance);
        uint256 tokenShareAtTopupPrice = poolConsideredEmpty ?
            collateralAtTopupPrice : assetData.poolTokenSupply.mulDiv(
                collateralAtTopupPrice, assetData.poolNatBalance);
        return tokenShareAtTopupPrice + tokenShareAtStandardPrice;
    }

    function _getAssetData() internal view returns (AssetData memory) {
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

    function fassetDebtOf(address _account) external view returns (uint256) {
        return _fassetDebtOf[_account];
    }

    function virtualFassetOf(address _account) external view returns (uint256) {
        AssetData memory assetData = _getAssetData();
        uint256 tokens = poolToken.balanceOf(_account);
        return assetData.poolVirtualFassetBalance.mulDiv(
            tokens, assetData.poolTokenSupply);
    }

    function debtTokensOf(address _account) external view returns (uint256) {
        return poolToken.balanceOf(_account) - liquidTokensOf(_account);
    }

    // note: integer operations round down the liquid tokens,
    // so the user can get slightly less tokens than those he owns mathematically
    // (we could also calculate liquid tokens as tokens - debtTokens)
    function liquidTokensOf(address _account) public view returns (uint256) {
        AssetData memory assetData = _getAssetData();
        uint256 tokens = poolToken.balanceOf(_account);
        if (tokens == 0) return 0; // prevents poolTokenSupply = 0
        uint256 debtFassets = _fassetDebtOf[_account];
        if (debtFassets == 0) return tokens; // prevents poolVirtualFassetBalance = 0
        uint256 requiredFassets = assetData.poolVirtualFassetBalance.mulDiv(
            tokens, assetData.poolTokenSupply);
        uint256 liquidFassets = requiredFassets - debtFassets;
        uint256 liquidTokens = assetData.poolTokenSupply.mulDiv(
            liquidFassets, assetData.poolVirtualFassetBalance);
        return liquidTokens;
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Methods to allow for liquidation/destruction of the pool by AssetManager or agent

    function destroy() external onlyAgent {
        IWNat wnat = assetManager.getWNat();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        uint256 poolFassetBalance = fAsset.balanceOf(address(this));
        if (poolBalanceNat == 0 && poolFassetBalance == 0) {
            poolToken.destroy();
            selfdestruct(agentVault);
        }
    }

    // used by AssetManager to handle liquidation
    function payout(address _recipient, uint256 _amount)
        external
        onlyAssetManager
        nonReentrant
    {
        IWNat wnat = assetManager.getWNat();
        wnat.transfer(_recipient, _amount);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Delegation of the pool's collateral and airdrop claimage (same as in AgentVault)

    function claimAirdropDistribution(IDistributionToDelegators _distribution, uint256 _month)
        external
        onlyAgent
        returns(uint256)
    {
        return _distribution.claim(agentVault, _month);
    }

    function optOutOfAirdrop(IDistributionToDelegators _distribution) external onlyAgent {
        _distribution.optOutOfAirdrop();
    }

    function delegateCollateral(
        address[] memory _to, uint256[] memory _bips
    ) external onlyAgent {
        IVPToken wnat = IVPToken(assetManager.getWNat());
        wnat.batchDelegate(_to, _bips);
    }

    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager, uint256 _lastRewardEpoch
    ) external nonReentrant {
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

    ////////////////////////////////////////////////////////////////////////////////////
    // auxiliary

    function min(uint256 a, uint256 b) private pure returns (uint256) {
        return a <= b ? a : b;
    }

}
