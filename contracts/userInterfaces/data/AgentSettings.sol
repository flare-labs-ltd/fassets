// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


library AgentSettings {
    struct Data {
        // The token used as vault collateral. Must be one of the tokens obtained by `getCollateralTypes()`,
        // with class VAULT.
        IERC20 vaultCollateralToken;

        // The suffix to pool token name and symbol that identifies new vault's collateral pool token.
        // Must be unique within an asset manager.
        string poolTokenSuffix;

        // Minting fee. Normally charged to minters for publicly available agents, but must be set
        // also for self-minting agents to pay part of it to collateral pool.
        // Fee is paid in underlying currency along with backing assets.
        uint256 feeBIPS;

        // Share of the minting fee that goes to the pool as percentage of the minting fee.
        // This share of fee is minted as f-assets and belongs to the pool.
        uint256 poolFeeShareBIPS;

        // Collateral ratio at which we calculate locked collateral and collateral available for minting.
        // Agent may set own value for minting collateral ratio on creation.
        // The value must always be greater than system minimum collateral ratio for vault collateral.
        // Warning: having this value near global min collateral ratio can quickly lead to liquidation for public
        // agents, so it is advisable to set it significantly higher.
        uint256 mintingVaultCollateralRatioBIPS;

        // Collateral ratio at which we calculate locked collateral and collateral available for minting.
        // Agent may set own value for minting collateral ratio on creation.
        // The value must always be greater than system minimum collateral ratio for pool collateral.
        // Warning: having this value near global min collateral ratio can quickly lead to liquidation for public
        // agents, so it is advisable to set it significantly higher.
        uint256 mintingPoolCollateralRatioBIPS;

        // The factor set by the agent to multiply the price at which agent buys f-assets from pool
        // token holders on self-close exit (when requested or the redeemed amount is less than 1 lot).
        uint256 buyFAssetByAgentFactorBIPS;

        // The minimum collateral ratio above which a staker can exit the pool
        // (this is CR that must be left after exit).
        // Must be higher than system minimum collateral ratio for pool collateral.
        uint256 poolExitCollateralRatioBIPS;

        // The CR below which it is possible to enter the pool at discounted rate (to prevent liquidation).
        // Must be higher than system minimum collateral ratio for pool collateral.
        uint256 poolTopupCollateralRatioBIPS;

        // The discount to pool token price when entering and pool CR is below pool topup CR.
        uint256 poolTopupTokenPriceFactorBIPS;

        // Agent's handshake type - minting or redeeming can be rejected.
        // 0 - no verification, 1 - manual verification, ...
        uint256 handshakeType;
    }
}
