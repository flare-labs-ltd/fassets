// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/assetManager/ICollateralTypes.sol";
import "../interfaces/assetManager/ICollateralTypesManagement.sol";
import "../library/CollateralTypes.sol";
import "./AssetManagerBase.sol";


contract CollateralTypesFacet is AssetManagerBase, ICollateralTypes, ICollateralTypesManagement {
    function addCollateralType(
        CollateralType.Data calldata _data
    )
        external override
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
        external override
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
        external override
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
        external view override
        returns (CollateralType.Data memory)
    {
        return CollateralTypes.getInfo(_collateralClass, _token);
    }

    /**
     * Get the list of all available and deprecated tokens used for collateral.
     */
    function getCollateralTypes()
        external view override
        returns (CollateralType.Data[] memory)
    {
        return CollateralTypes.getAllInfos();
    }
}
