// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../library/CollateralTypes.sol";
import "./AssetManagerBase.sol";


contract CollateralTypesFacet is AssetManagerBase {
    function addCollateralType(
        CollateralType.Data calldata _data
    )
        external
        onlyAssetManagerController
    {
        CollateralTypes.add(_data);
    }

    function setCollateralRatiosForToken(
        CollateralType.Class _collateralClass,
        IERC20 _token,
        uint256 _minCollateralRatioBIPS,
        uint256 _ccbMinCollateralRatioBIPS,
        uint256 _safetyMinCollateralRatioBIPS
    )
        external
        onlyAssetManagerController
    {
        CollateralTypes.setCollateralRatios(_collateralClass, _token,
            _minCollateralRatioBIPS, _ccbMinCollateralRatioBIPS, _safetyMinCollateralRatioBIPS);
    }

    function deprecateCollateralType(
        CollateralType.Class _collateralClass,
        IERC20 _token,
        uint256 _invalidationTimeSec
    )
        external
        onlyAssetManagerController
    {
        CollateralTypes.deprecate(_collateralClass, _token, _invalidationTimeSec);
    }

    /**
     * Get collateral  information about a token.
     */
    function getCollateralType(
        CollateralType.Class _collateralClass,
        IERC20 _token
    )
        external view
        returns (CollateralType.Data memory)
    {
        return CollateralTypes.getInfo(_collateralClass, _token);
    }

    /**
     * Get the list of all available and deprecated tokens used for collateral.
     */
    function getCollateralTypes()
        external view
        returns (CollateralType.Data[] memory)
    {
        return CollateralTypes.getAllInfos();
    }
}
