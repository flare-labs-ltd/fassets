// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


library CollateralToken {
    enum TokenClass {
        NONE,   // unused
        CLASS1, // usable as class 1 collateral
        POOL    // pool collateral type
    }

    struct Data {
        // Identifier used to access token for updating or getting info.
        string identifier;

        // The ERC20 token contract for this collateral type.
        // immutable
        IERC20 token;

        // The kind of collateral for this token.
        CollateralToken.TokenClass tokenClass;

        // Same as token.decimals(), when that exists.
        // immutable
        uint8 decimals;

        // Index in the FtsoRegistry corresponding to ftsoSymbol, automatically calculated from ftsoSymbol.
        // autogenerated
        uint16 ftsoIndex;

        // If some token should not be used anymore as collateral, it has to be announced in advance and it
        // is still valid until this timestamp. After that time, the corresponding collateral is considered as
        // zero and the agents that haven't replaced it are liquidated.
        // When the invalidation has not been announced, this value is 0.
        uint64 validUntil;

        // FTSO symbol for token.
        string ftsoSymbol;

        // Minimum collateral ratio for healthy agents.
        // timelocked
        uint32 minCollateralRatioBIPS;

        // Minimum collateral ratio for agent in CCB (Collateral call band).
        // If the agent's collateral ratio is less than this, skip the CCB and go straight to liquidation.
        // A bit smaller than minCollateralRatioBIPS.
        // timelocked
        uint32 ccbMinCollateralRatioBIPS;

        // Minimum collateral ratio required to get agent out of liquidation.
        // Wiil always be greater than minCollateralRatioBIPS.
        // timelocked
        uint32 safetyMinCollateralRatioBIPS;
    }
}
