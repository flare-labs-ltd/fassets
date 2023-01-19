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


contract CollateralPool {
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
        // TODO: prevent division by zero or small "dust"
        uint256 fassetShare = SafePct.mulDiv(fAsset.balanceOf(address(this)), msg.value, poolBalanceNat);
        require(fAsset.allowance(msg.sender, address(this)) >= fassetShare,
            "f-asset allowance too small");
        fAsset.transferFrom(msg.sender, address(this), fassetShare);
        // TODO: prevent division by zero or small "dust"
        uint256 tokenShare = SafePct.mulDiv(poolToken.totalSupply(), msg.value, poolBalanceNat);
        poolToken.mint(msg.sender, tokenShare);
    }
    
    function _enterWithoutFassets() private {
        IWNat wnat = assetManager.getWNat();
        (uint256 assetPriceMul, uint256 assetPriceDiv) = assetManager.assetPriceNatWei();
        uint256 pricePremiumMul = SafeBips.mulBips(assetPriceMul, enterBuyAssetRateBIPS);
        uint256 poolBalanceNatWithAssets = wnat.balanceOf(address(this)) +
            SafePct.mulDiv(fAsset.balanceOf(address(this)), pricePremiumMul, assetPriceDiv);
        // TODO: prevent division by zero or small "dust"
        uint256 tokenShare = SafePct.mulDiv(poolToken.totalSupply(), msg.value, poolBalanceNatWithAssets);
        uint256 mintAt = block.timestamp + enterWithoutFAssetMintDelaySeconds;
        poolToken.mintDelayed(msg.sender, tokenShare, mintAt);
    }
}
