// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/SafeBips.sol";
import "../interface/IWNat.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAgentVault.sol";
import "./CollateralPoolToken.sol";

import "../library/AssetManagerSettings.sol";


contract CollateralPool is ReentrancyGuard {
    uint256 public constant CLAIM_FTSO_REWARDS_INTEREST_BIPS = 3;
    uint256 internal constant MAX_NAT_TO_POOL_TOKEN_RATIO = 1000;
    
    IAssetManager public immutable assetManager;
    IERC20 public immutable fAsset;
    address public immutable agentVault;
    CollateralPoolToken public poolToken;
    IFtsoRegistry public ftsoRegistry;
    uint16 public enterBuyAssetRateBIPS; // = 1 + premium
    uint64 public enterWithoutFAssetMintDelaySeconds;
    uint256 public exitCRBIPS;

    modifier onlyAssetManager {
        require(msg.sender == address(assetManager), "only asset manager");
        _;
    }
    
    function enter(bool _depositFassets) external payable {
        if (_depositFassets) {
            _enterWithFassets();
        } else {
            _enterWithoutFassets();
        }
        IWNat wnat = assetManager.getWNat();
        wnat.deposit{value: msg.value}();
    }

    function exit(uint256 _tokenShare) external nonReentrant {
        require(_tokenShare > 0, "token share is zero");
        IWNat wnat = assetManager.getWNat();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        uint256 poolTokenSupply = poolToken.totalSupply();
        uint256 fassetBalance = fAsset.balanceOf(address(this));
        // poolTokenSupply >= _tokenShare > 0
        uint256 natShare = SafePct.mulDiv(_tokenShare, poolBalanceNat, poolTokenSupply);
        uint256 fassetShare = SafePct.mulDiv(_tokenShare, fassetBalance, poolTokenSupply);
        // checking whether the new collateral ratio is above exitCR
        uint256 fAssetIndex = 1; // GET fAsset index!
        uint256 updatedPoolBalanceNat = SafeMath.sub(poolBalanceNat, natShare);
        uint256 updatedFassetBalance = SafeMath.sub(fassetBalance, fassetShare);
        IFtso fassetFtso = ftsoRegistry.getFtso(fAssetIndex);
        (uint256 fassetPriceMul, uint256 fassetPriceDiv) = fassetFtso.getCurrentPrice();
        (uint256 wnatPriceMul, uint256 wnatPriceDiv) = assetManager.assetPriceNatWei();
        uint256 lhs = SafeMath.mul(updatedPoolBalanceNat, SafeMath.mul(wnatPriceMul, fassetPriceDiv));
        uint256 rhs = SafeMath.mul(updatedFassetBalance, SafeMath.mul(fassetPriceMul, wnatPriceDiv));
        require(lhs >= SafeBips.mulBips(rhs, exitCRBIPS), "collateral ratio below exitCR");
        // execute transfers if the collateral ratio stays above exitCR
        wnat.transfer(msg.sender, natShare);
        if (fassetShare > 0) {
            fAsset.transfer(msg.sender, fassetShare);
        }
        poolToken.burn(msg.sender, _tokenShare); // checks that balance >= _tokenShare
    }

    // requires the amount of fassets that don't change the pool collateral ratio
    function selfCloseExit(
        bool _getAgentCollateral, uint256 _tokenShare, 
        string memory _redeemerUnderlyingAddressString
    ) public {
        require(_tokenShare > 0, "token share is zero");
        IWNat wnat = assetManager.getWNat();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        uint256 poolTokenSupply = poolToken.totalSupply();
        uint256 fassetBalance = fAsset.balanceOf(address(this));
        // poolTokenSupply >= _tokenShare > 0
        uint256 natShare = SafePct.mulDiv(_tokenShare, poolBalanceNat, poolTokenSupply); // can be 0?!
        uint256 fassetShare = SafePct.mulDiv(_tokenShare, fassetBalance, poolTokenSupply);
        // calculate the msg.sender's additionally required fassets
        uint256 updatedPoolBalanceNat = SafeMath.sub(poolBalanceNat, natShare);
        uint256 requiredFassets = SafeMath.sub(
            updatedPoolBalanceNat / poolBalanceNat, SafeMath.add(fassetBalance, fassetShare));
        if (requiredFassets > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= requiredFassets,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), requiredFassets);
        }
        wnat.transfer(msg.sender, natShare);
        poolToken.burn(msg.sender, _tokenShare);
        uint256 redeemedFassets = fassetShare + requiredFassets;
        if (redeemedFassets > 0) {
            AssetManagerSettings.Settings memory settings = assetManager.getSettings();
            uint256 lotsToRedeem = redeemedFassets / settings.lotSizeAMG;
            if (lotsToRedeem == 0 || _getAgentCollateral) {
                assetManager.redeemChosenAgentCollateral(
                    agentVault, redeemedFassets, msg.sender);
            } else {
                assetManager.redeemChosenAgentUnderlying(
                    agentVault, redeemedFassets, _redeemerUnderlyingAddressString);
            }
        }
    }

    // helper function for self-close exits that are paid 
    // with agent's collateral
    function selfCloseExitPaidWithCollateral(uint256 _tokenShare) external {
        selfCloseExit(true, _tokenShare, "");
    }
    
    function _enterWithFassets() private {
        IWNat wnat = assetManager.getWNat();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        uint256 poolTokenSupply = poolToken.totalSupply();
        uint256 fassetBalance = fAsset.balanceOf(address(this));
        require(poolTokenSupply <= poolBalanceNat * MAX_NAT_TO_POOL_TOKEN_RATIO, "nat balance too low");
        // If poolBalanceNat=0 then poolTokenSupply=0 due to require above.
        // So the entering staker is the only one and he can take all fassets, if there are any
        // (anyway, while such situation could theoretically happen due to agent slashing, it is very unlikely).
        // TODO: check if it is possible (can agent slashing ever go to 0?)
        uint256 fassetShare = poolBalanceNat > 0 ? 
            SafePct.mulDiv(fassetBalance, msg.value, poolBalanceNat) : 0;
        if (fassetShare > 0) {
            require(fAsset.allowance(msg.sender, address(this)) >= fassetShare,
                "f-asset allowance too small");
            fAsset.transferFrom(msg.sender, address(this), fassetShare);
        }
        // if poolBalanceNat=0 then also poolTokenSupply=0 due to require above and we use ratio 1
        uint256 tokenShare = poolBalanceNat > 0 ? 
            SafePct.mulDiv(poolTokenSupply, msg.value, poolBalanceNat) : msg.value;
        poolToken.mint(msg.sender, tokenShare);
    }
    
    function _enterWithoutFassets() private {
        IWNat wnat = assetManager.getWNat();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        uint256 poolTokenSupply = poolToken.totalSupply();
        uint256 fassetBalance = fAsset.balanceOf(address(this));
        require(poolTokenSupply <= poolBalanceNat * MAX_NAT_TO_POOL_TOKEN_RATIO, "nat balance too low");
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        uint256 pricePremiumMul = SafeBips.mulBips(assetPriceMul, enterBuyAssetRateBIPS);
        uint256 poolBalanceNatWithAssets = poolBalanceNat + 
            SafePct.mulDiv(fassetBalance, pricePremiumMul, assetPriceDiv);
        // This condition prevents division by 0, since poolBalanceNatWithAssets >= poolBalanceNat.
        // Conversely, if poolBalanceNat=0 then poolTokenSupply=0 due to require above and we mint tokens at ratio 1.
        // In this case the entering staker is the only one and he can take all fassets, if there are any
        // (anyway, while such situation could theoretically happen due to agent slashing, it is very unlikely).
        uint256 tokenShare = poolBalanceNat > 0 ?
            SafePct.mulDiv(poolTokenSupply, msg.value, poolBalanceNatWithAssets) : msg.value;
        uint256 mintAt = block.timestamp + enterWithoutFAssetMintDelaySeconds;
        poolToken.mintDelayed(msg.sender, tokenShare, mintAt);
    }

    // used by AssetManager to handle liquidation (only need access of the pool collateral)
    function payout(address _recipient, uint256 _amount)
        external
        onlyAssetManager
        nonReentrant
    {
        IWNat wnat = assetManager.getWNat();
        wnat.transfer(_recipient, _amount);
    }

    ////////////////////////////////////////////////////////////////////////////////////
    // Delegation of the pool's collateral

    // implement onlyAdmin modifier
    function delegateCollateral(
        address[] memory _to, uint256[] memory _bips
    ) external {
        IVPToken wnat = IVPToken(assetManager.getWNat());
        wnat.batchDelegate(_to, _bips);
    }

    // make non reentrant
    function claimFtsoRewards(
        IFtsoRewardManager _ftsoRewardManager, uint256 _lastRewardEpoch
    ) external nonReentrant {
        uint256 ftsoRewards = _ftsoRewardManager.claim(
            address(this), payable(address(this)), _lastRewardEpoch, false
        );
        uint256 callerReward = SafeBips.mulBips(
            ftsoRewards, CLAIM_FTSO_REWARDS_INTEREST_BIPS);
        if (callerReward > 0) {
            /* solhint-disable avoid-low-level-calls */
            //slither-disable-next-line arbitrary-send-eth
            (bool success, ) = msg.sender.call{value: callerReward}("");
            /* solhint-enable avoid-low-level-calls */
            require(success, "transfer failed");
        }
    } 

}
