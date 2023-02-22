// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/SafeBips.sol";
import "../interface/IWNat.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAgentVault.sol";
import "./CollateralPoolToken.sol";

contract CollateralPool is ReentrancyGuard {

    using SafePct for uint256;
    using SafeBips for uint256;

    uint256 public constant CLAIM_FTSO_REWARDS_INTEREST_BIPS = 3;
    uint256 internal constant MAX_NAT_TO_POOL_TOKEN_RATIO = 1000;

    address payable public immutable agentVault;
    IAssetManager public immutable assetManager;
    IERC20 public immutable fAsset;
    CollateralPoolToken public poolToken;
    uint256 public exitCRBIPS;
    uint256 public topupCRBIPS;
    uint256 public topupTokenDiscountBIPS;

    mapping(address => uint256) public fassetDebtOf;
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
    }

    function setPoolToken(address _poolToken) external onlyAgent {
        if (address(poolToken) == address(0)) {
            poolToken = CollateralPoolToken(_poolToken);
        }
    }

    function enter(uint256 _fassets, bool _enterWithFullFassets) external payable {
        IWNat wnat = assetManager.getWNat();
        uint256 poolTokenSupply = poolToken.totalSupply();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        require(poolTokenSupply <= poolBalanceNat * MAX_NAT_TO_POOL_TOKEN_RATIO, "nat balance too small");
        uint256 poolFassetBalance = fAsset.balanceOf(address(this));
        uint256 poolVirtualFassetBalance = poolFassetBalance + poolFassetDebt;
        // calculate obtained pool tokens and liquid fassets
        uint256 tokens = _collateralToTokenShare(msg.value);
        uint256 fassets = poolBalanceNat == 0 ?
            0 : poolVirtualFassetBalance.mulDiv(msg.value, poolBalanceNat);
        uint256 liquidFassets = _enterWithFullFassets ?
            fassets : min(_fassets, fassets);
        // log msg.sender fasset debt
        uint256 debtFassets = fassets - liquidFassets;
        fassetDebtOf[msg.sender] += debtFassets;
        poolFassetDebt += debtFassets;
        // transfer/mint calculated assets
        if (liquidFassets > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= liquidFassets,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), liquidFassets);
        }
        wnat.deposit{value: msg.value}();
        poolToken.mint(msg.sender, tokens);
    }

    function fullExit() external {
        exit(liquidTokensOf(msg.sender));
    }

    function exit(uint256 _tokenShare) public {
        require(_tokenShare > 0, "token share is zero");
        IWNat wnat = assetManager.getWNat();
        uint256 poolTokenSupply = poolToken.totalSupply();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        uint256 fassetSupply = fAsset.totalSupply();
        // poolTokenSupply >= _tokenShare > 0
        uint256 natShare = _tokenShare.mulDiv(poolBalanceNat, poolTokenSupply);
        require(natShare > 0, "amount of supplied tokens is too small");
        // check whether the new collateral ratio is above exitCR
        uint256 updatedPoolBalanceNat = poolBalanceNat - natShare;
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        uint256 lhs = updatedPoolBalanceNat * assetPriceDiv;
        uint256 rhs = fassetSupply * assetPriceMul;
        require(lhs >= rhs.mulBips(exitCRBIPS), "collateral ratio falls below exitCR");
        // execute wnat transfer
        wnat.transfer(msg.sender, natShare);
        // execute fasset transfer
        uint256 poolFassetBalance = fAsset.balanceOf(address(this));
        uint256 poolVirtualFassetBalance = poolFassetBalance + poolFassetDebt;
        uint256 fassetShare = poolVirtualFassetBalance.mulDiv(_tokenShare, poolTokenSupply);
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
        bool _getAgentCollateral, uint256 _tokenShare,
        string memory _redeemerUnderlyingAddressString
    ) public {
        require(_tokenShare > 0, "token share is zero");
        IWNat wnat = assetManager.getWNat();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        uint256 poolTokenSupply = poolToken.totalSupply();
        uint256 fassetSupply = fAsset.totalSupply();
        uint256 poolFassetBalance = fAsset.balanceOf(address(this));
        // poolTokenSupply >= _tokenShare > 0
        uint256 natShare = poolBalanceNat.mulDiv(_tokenShare, poolTokenSupply);
        require(natShare > 0, "amount of supplied tokens is too small");
        uint256 fassetShare = poolFassetBalance.mulDiv(_tokenShare, poolTokenSupply);
        // calculate msg.sender's additionally required fassets
        uint256 updatedPoolBalanceNat = poolBalanceNat - natShare;
        uint256 updatedFassetSupply = fassetSupply - fassetShare;
        uint256 exemptionFassets = poolFassetBalance.mulDiv(updatedPoolBalanceNat, poolBalanceNat);
        uint256 additionallyRequiredFassets = exemptionFassets <= updatedFassetSupply ?
            updatedFassetSupply - exemptionFassets : 0;
        if (additionallyRequiredFassets > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= additionallyRequiredFassets,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), additionallyRequiredFassets);
        }
        // execute asset transfer/burn
        wnat.transfer(msg.sender, natShare);
        poolToken.burn(msg.sender, _tokenShare);
        uint256 redeemedFassets = fassetShare + additionallyRequiredFassets;
        if (redeemedFassets > 0) {
            uint256 lotSizeAMG = assetManager.getLotSizeAMG();
            uint256 lotsToRedeem = redeemedFassets / lotSizeAMG;
            if (lotsToRedeem == 0 || _getAgentCollateral) {
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

    // function that calculates the amount of token bought with collateral
    // note: this is complicated due to the topup discount
    function _collateralToTokenShare(uint256 _collateral) private view returns (uint256) {
        IWNat wnat = assetManager.getWNat();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        if (poolBalanceNat == 0) return _collateral;
        uint256 poolTokenSupply = poolToken.totalSupply();
        uint256 fassetSupply = fAsset.totalSupply();
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        // calculate amount of nat at topup price and nat at normal price
        uint256 lhs = assetPriceDiv * poolBalanceNat;
        uint256 rhs = assetPriceMul * fassetSupply;
        uint256 topupAssetPriceMul = assetPriceMul.mulBips(topupCRBIPS);
        uint256 natRequiredToTopup = lhs < rhs.mulBips(topupCRBIPS) ?
            fassetSupply.mulDiv(topupAssetPriceMul, assetPriceDiv) - poolBalanceNat : 0;
        uint256 collateralAtTopupPrice = _collateral < natRequiredToTopup ?
            _collateral : natRequiredToTopup;
        uint256 collateralAtNormalPrice = collateralAtTopupPrice < _collateral ?
            _collateral - collateralAtTopupPrice : 0;
        uint256 tokenShareAtTopupPrice = poolTokenSupply.mulDiv(
            collateralAtTopupPrice, poolBalanceNat.mulBips(topupTokenDiscountBIPS));
        uint256 tokenShareAtNormalPrice = poolTokenSupply.mulDiv(
            collateralAtNormalPrice, poolBalanceNat);
        return tokenShareAtTopupPrice + tokenShareAtNormalPrice;
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // methods used by CollateralPoolToken

    // note: integer operations round down the liquid tokens,
    // so the user can get slightly less tokens than those he owns mathematically
    // (we could also calculate liquid tokens as tokens - debtTokens)
    function liquidTokensOf(address _account) public view returns (uint256) {
        uint256 poolTokenSupply = poolToken.totalSupply();
        uint256 poolFassetBalance = fAsset.balanceOf(address(this));
        uint256 poolVirtualFassetBalance = poolFassetBalance + poolFassetDebt;
        uint256 tokens = poolToken.balanceOf(_account);
        uint256 fassets = poolVirtualFassetBalance.mulDiv(tokens, poolTokenSupply);
        uint256 debtFassets = fassetDebtOf[_account];
        uint256 liquidFassets = fassets - debtFassets;
        uint256 liquidTokens = poolTokenSupply.mulDiv(liquidFassets, poolVirtualFassetBalance);
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
