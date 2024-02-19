// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "../data/CollateralType.sol";


/**
 * Available collateral types
 */
interface ICollateralTypes {
    /**
     * Get collateral  information about a token.
     */
    function getCollateralType(CollateralType.Class _collateralClass, IERC20 _token)
        external view
        returns (CollateralType.Data memory);

    /**
     * Get the list of all available and deprecated tokens used for collateral.
     */
    function getCollateralTypes()
        external view
        returns (CollateralType.Data[] memory);
}
