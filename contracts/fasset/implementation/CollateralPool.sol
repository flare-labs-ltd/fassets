// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../utils/lib/SafePct.sol";
import "../interface/IWNat.sol";
import "../interface/IAssetManager.sol";
import "../interface/IAgentVault.sol";
import "./CollateralPoolToken.sol";


contract CollateralPool {
    uint256 internal constant MAX_NAT_TO_POOL_TOKEN_RATIO = 1000;
    
    IAssetManager public immutable assetManager;
    IERC20 public immutable fAsset;
    address public immutable agentVault;
    CollateralPoolToken public poolToken;
    uint16 public enterBuyAssetRateBIPS; // = 1 + premium
    uint64 public enterWithoutFAssetMintDelaySeconds;
    
    function enter(bool _depositFassets) external payable {
        if (_depositFassets) {
            _enterWithFassets();
        } else {
            _enterWithoutFassets();
        }
    }
    
    function _enterWithFassets() private {
        IWNat wnat = assetManager.getWNat();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        uint256 poolTokenSuply = poolToken.totalSupply();
        uint256 fassetBalance = fAsset.balanceOf(address(this));
        require(poolTokenSuply <= poolBalanceNat * MAX_NAT_TO_POOL_TOKEN_RATIO, "nat balance too low");
        // If poolBalanceNat=0 then poolTokenSuply=0 due to require above.
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
        // if poolBalanceNat=0 then also poolTokenSuply=0 due to require above and we use ratio 1
        uint256 tokenShare = poolBalanceNat > 0 ? 
            SafePct.mulDiv(poolTokenSuply, msg.value, poolBalanceNat) : msg.value;
        poolToken.mint(msg.sender, tokenShare);
    }
    
    function _enterWithoutFassets() private {
        IWNat wnat = assetManager.getWNat();
        uint256 poolBalanceNat = wnat.balanceOf(address(this));
        uint256 poolTokenSuply = poolToken.totalSupply();
        uint256 fassetBalance = fAsset.balanceOf(address(this));
        require(poolTokenSuply <= poolBalanceNat * MAX_NAT_TO_POOL_TOKEN_RATIO, "nat balance too low");
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        uint256 pricePremiumMul = SafePct.mulBips(assetPriceMul, enterBuyAssetRateBIPS);
        uint256 poolBalanceNatWithAssets = poolBalanceNat + 
            SafePct.mulDiv(fassetBalance, pricePremiumMul, assetPriceDiv);
        // This condition prevents division by 0, since poolBalanceNatWithAssets >= poolBalanceNat.
        // Conversely, if poolBalanceNat=0 then poolTokenSuply=0 due to require above and we mint tokens at ratio 1.
        // In this case the entering staker is the only one and he can take all fassets, if there are any
        // (anyway, while such situation could theoretically happen due to agent slashing, it is very unlikely).
        uint256 tokenShare = poolBalanceNat > 0 ?
            SafePct.mulDiv(poolTokenSuply, msg.value, poolBalanceNatWithAssets) : msg.value;
        uint256 mintAt = block.timestamp + enterWithoutFAssetMintDelaySeconds;
        poolToken.mintDelayed(msg.sender, tokenShare, mintAt);
    }
}
