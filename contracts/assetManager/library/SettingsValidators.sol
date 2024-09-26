// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../utils/lib/SafePct.sol";
import "./Globals.sol";

library SettingsValidators {
    using SafePct for *;

    uint256 internal constant MAXIMUM_PROOF_WINDOW = 1 days;

    function validateTimeForPayment(
        uint256 _underlyingBlocks,
        uint256 _underlyingSeconds,
        uint256 _averageBlockTimeMS
    )
        internal pure
    {
        require(_underlyingSeconds <= MAXIMUM_PROOF_WINDOW, "value too high");
        require(_underlyingBlocks * _averageBlockTimeMS / 1000 <= MAXIMUM_PROOF_WINDOW, "value too high");
    }

    function validateLiquidationFactors(
        uint256[] memory liquidationFactors,
        uint256[] memory vaultCollateralFactors
    )
        internal pure
    {
        require(liquidationFactors.length == vaultCollateralFactors.length, "lengths not equal");
        require(liquidationFactors.length >= 1, "at least one factor required");
        for (uint256 i = 0; i < liquidationFactors.length; i++) {
            // per item validations
            require(liquidationFactors[i] > SafePct.MAX_BIPS, "factor not above 1");
            require(vaultCollateralFactors[i] <= liquidationFactors[i], "vault collateral factor higher than total");
            require(i == 0 || liquidationFactors[i] > liquidationFactors[i - 1], "factors not increasing");
        }
    }
}
