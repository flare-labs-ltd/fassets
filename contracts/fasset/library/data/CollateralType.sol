// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../../userInterfaces/data/CollateralType.sol";


library CollateralTypeInt {
    struct Data {
        // The ERC20 token contract for this collateral type.
        // immutable
        IERC20 token;

        // The kind of collateral for this token.
        // immutable
        CollateralType.Class collateralClass;

        // Same as token.decimals(), when that exists.
        // immutable
        uint8 decimals;

        // If some token should not be used anymore as collateral, it has to be announced in advance and it
        // is still valid until this timestamp. After that time, the corresponding collateral is considered as
        // zero and the agents that haven't replaced it are liquidated.
        // When the invalidation has not been announced, this value is 0.
        uint64 validUntil;

        // When `true`, the FTSO with symbol `assetFtsoSymbol` returns asset price relative to this token
        // (such FTSO's will probably exist for major stablecoins).
        // When `false`, the FTSOs with symbols `assetFtsoSymbol` and `tokenFtsoSymbol` give asset and token
        // price relative to the same reference currency and the asset/token price is calculated as their ratio.
        // immutable
        bool directPricePair;

        // FTSO symbol for the asset, relative to this token or a reference currency
        // (it depends on the value of `directPricePair`).
        // immutable
        string assetFtsoSymbol;

        // FTSO symbol for this token in reference currency.
        // Used for asset/token price calculation when `directPricePair` is `false`.
        // Otherwise it is irrelevant to asset/token price calculation, but if it is nonempty,
        // it is still used in calculation of challenger and confirmation rewards
        // (otherwise we assume it approximates the value of USD and pay directly the USD amount in class1).
        // immutable
        string tokenFtsoSymbol;

        // Minimum collateral ratio for healthy agents.
        // timelocked
        uint32 minCollateralRatioBIPS;

        // Minimum collateral ratio for agent in CCB (Collateral call band).
        // If the agent's collateral ratio is less than this, skip the CCB and go straight to liquidation.
        // A bit smaller than minCollateralRatioBIPS.
        // timelocked
        uint32 ccbMinCollateralRatioBIPS;

        // Minimum collateral ratio required to get agent out of liquidation.
        // Will always be greater than minCollateralRatioBIPS.
        // timelocked
        uint32 safetyMinCollateralRatioBIPS;
    }
}
