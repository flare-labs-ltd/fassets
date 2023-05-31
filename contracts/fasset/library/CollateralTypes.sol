// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";


library CollateralTypes {
    using SafeCast for uint256;

    function initialize(
        CollateralType.Data[] memory _data
    )
        external
    {
        require(_data.length >= 2, "at least two collaterals required");
        // initial pool collateral token
        require(_data[0].collateralClass == CollateralType.Class.POOL, "not a pool collateral at 0");
        _add(_data[0]);
        _setPoolCollateralTypeIndex(0);
        // initial class1 tokens
        for (uint256 i = 1; i < _data.length; i++) {
            require(_data[i].collateralClass == CollateralType.Class.CLASS1, "not a class1 collateral");
            _add(_data[i]);
        }
    }

    function add(
        CollateralType.Data memory _data
    )
        external
    {
        require(_data.collateralClass == CollateralType.Class.CLASS1, "not a class1 collateral");
        _add(_data);
    }

    function setCollateralRatios(
        CollateralType.Class _collateralClass,
        IERC20 _token,
        uint256 _minCollateralRatioBIPS,
        uint256 _ccbMinCollateralRatioBIPS,
        uint256 _safetyMinCollateralRatioBIPS
    )
        external
    {
        bool ratiosValid =
            SafePct.MAX_BIPS < _ccbMinCollateralRatioBIPS &&
            _ccbMinCollateralRatioBIPS <= _minCollateralRatioBIPS &&
            _minCollateralRatioBIPS <= _safetyMinCollateralRatioBIPS;
        require(ratiosValid, "invalid collateral ratios");
        // update
        CollateralTypeInt.Data storage token = CollateralTypes.get(_collateralClass, _token);
        token.minCollateralRatioBIPS = _minCollateralRatioBIPS.toUint32();
        token.ccbMinCollateralRatioBIPS = _ccbMinCollateralRatioBIPS.toUint32();
        token.safetyMinCollateralRatioBIPS = _safetyMinCollateralRatioBIPS.toUint32();
        emit AMEvents.CollateralRatiosChanged(uint8(_collateralClass), address(_token),
            _minCollateralRatioBIPS, _ccbMinCollateralRatioBIPS, _safetyMinCollateralRatioBIPS);
    }

    function deprecate(
        CollateralType.Class _collateralClass,
        IERC20 _token,
        uint256 _invalidationTimeSec
    )
        external
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        CollateralTypeInt.Data storage token = CollateralTypes.get(_collateralClass, _token);
        require(isValid(token), "token not valid");
        require(_invalidationTimeSec >= settings.tokenInvalidationTimeMinSeconds, "deprecation time to short");
        uint256 validUntil = block.timestamp + _invalidationTimeSec;
        token.validUntil = validUntil.toUint64();
        emit AMEvents.CollateralTypeDeprecated(uint8(_collateralClass), address(_token), validUntil);
    }

    function setPoolWNatCollateralType(
        CollateralType.Data memory _data
    )
        external
    {
        require(_data.collateralClass == CollateralType.Class.POOL, "not a pool collateral");
        uint256 index = _add(_data);
        _setPoolCollateralTypeIndex(index);
    }

    function getInfo(
        CollateralType.Class _collateralClass,
        IERC20 _token
    )
        external view
        returns (CollateralType.Data memory)
    {
        CollateralTypeInt.Data storage token = CollateralTypes.get(_collateralClass, _token);
        return _getInfo(token);
    }

    function getAllInfos()
        external view
        returns (CollateralType.Data[] memory _result)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 length = state.collateralTokens.length;
        _result = new CollateralType.Data[](length);
        for (uint256 i = 0; i < length; i++) {
            _result[i] = _getInfo(state.collateralTokens[i]);
        }
    }

    function get(
        CollateralType.Class _collateralClass,
        IERC20 _token
    )
        internal view
        returns (CollateralTypeInt.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 index = state.collateralTokenIndex[_tokenKey(_collateralClass, _token)];
        require(index > 0, "unknown token");
        return state.collateralTokens[index - 1];
    }

    function getIndex(
        CollateralType.Class _collateralClass,
        IERC20 _token
    )
        internal view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 index = state.collateralTokenIndex[_tokenKey(_collateralClass, _token)];
        require(index > 0, "unknown token");
        return index - 1;
    }

    function tryGetIndex(
        CollateralType.Class _collateralClass,
        IERC20 _token
    )
        internal view
        returns (bool _found, uint256 _index)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 index = state.collateralTokenIndex[_tokenKey(_collateralClass, _token)];
        _found = index > 0;
        _index = _found ? index - 1 : 0;
    }

    function isValid(CollateralTypeInt.Data storage _token)
        internal view
        returns (bool)
    {
        return _token.validUntil == 0 || _token.validUntil > block.timestamp;
    }

    function _add(CollateralType.Data memory _data) private returns (uint256) {
        AssetManagerState.State storage state = AssetManagerState.get();
        // validation of collateralClass is done before call to _add
        require(address(_data.token) != address(0), "token zero");
        bytes32 tokenKey = _tokenKey(_data.collateralClass, _data.token);
        require(state.collateralTokenIndex[tokenKey] == 0, "token already exists");
        require(_data.validUntil == 0, "cannot add deprecated token");
        bool ratiosValid =
            SafePct.MAX_BIPS < _data.ccbMinCollateralRatioBIPS &&
            _data.ccbMinCollateralRatioBIPS <= _data.minCollateralRatioBIPS &&
            _data.minCollateralRatioBIPS <= _data.safetyMinCollateralRatioBIPS;
        require(ratiosValid, "invalid collateral ratios");
        uint256 newTokenIndex = state.collateralTokens.length;
        state.collateralTokens.push(CollateralTypeInt.Data({
            token: _data.token,
            collateralClass: _data.collateralClass,
            decimals: _data.decimals.toUint8(),
            validUntil: _data.validUntil.toUint64(),
            directPricePair: _data.directPricePair,
            assetFtsoSymbol: _data.assetFtsoSymbol,
            tokenFtsoSymbol: _data.tokenFtsoSymbol,
            minCollateralRatioBIPS: _data.minCollateralRatioBIPS.toUint32(),
            ccbMinCollateralRatioBIPS: _data.ccbMinCollateralRatioBIPS.toUint32(),
            safetyMinCollateralRatioBIPS: _data.safetyMinCollateralRatioBIPS.toUint32()
        }));
        state.collateralTokenIndex[tokenKey] = newTokenIndex + 1;   // 0 means empty
        emit AMEvents.CollateralTypeAdded(uint8(_data.collateralClass), address(_data.token), _data.decimals,
            _data.directPricePair, _data.assetFtsoSymbol, _data.tokenFtsoSymbol,
            _data.minCollateralRatioBIPS, _data.ccbMinCollateralRatioBIPS, _data.safetyMinCollateralRatioBIPS);
        return newTokenIndex;
    }

    function _setPoolCollateralTypeIndex(uint256 _index) private {
        AssetManagerState.State storage state = AssetManagerState.get();
        CollateralTypeInt.Data storage token = state.collateralTokens[_index];
        require(token.collateralClass == CollateralType.Class.POOL, "not a pool collateral token");
        state.poolCollateralIndex = _index.toUint16();
    }

    function _getInfo(CollateralTypeInt.Data storage token)
        private view
        returns (CollateralType.Data memory)
    {
        return CollateralType.Data({
            token: token.token,
            collateralClass: token.collateralClass,
            decimals: token.decimals,
            validUntil: token.validUntil,
            directPricePair: token.directPricePair,
            assetFtsoSymbol: token.assetFtsoSymbol,
            tokenFtsoSymbol: token.tokenFtsoSymbol,
            minCollateralRatioBIPS: token.minCollateralRatioBIPS,
            ccbMinCollateralRatioBIPS: token.ccbMinCollateralRatioBIPS,
            safetyMinCollateralRatioBIPS: token.safetyMinCollateralRatioBIPS
        });
    }

    function _tokenKey(
        CollateralType.Class _collateralClass,
        IERC20 _token
    )
        private pure
        returns (bytes32)
    {
        return bytes32((uint256(_collateralClass) << 160) | uint256(uint160(address(_token))));
    }
}
