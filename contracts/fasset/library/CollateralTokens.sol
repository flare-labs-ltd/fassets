// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";


library CollateralTokens {
    using SafeCast for uint256;

    function initialize(
        IAssetManager.CollateralTokenInfo[] memory _data
    )
        external
    {
        require(_data.length >= 2, "at least two collaterals required");
        // initial pool collateral token
        require(_data[0].tokenClass == IAssetManager.CollateralTokenClass.POOL, "not a pool collateral at 0");
        _add(_data[0]);
        _setPoolCollateralTokenIndex(0);
        // initial class1 tokens
        for (uint256 i = 1; i < _data.length; i++) {
            require(_data[i].tokenClass == IAssetManager.CollateralTokenClass.CLASS1, "not a class1 collateral");
            _add(_data[i]);
        }
    }

    function add(
        IAssetManager.CollateralTokenInfo memory _data
    )
        external
    {
        require(_data.tokenClass == IAssetManager.CollateralTokenClass.CLASS1, "not a class1 collateral");
        _add(_data);
    }

    function setCollateralRatios(
        IAssetManager.CollateralTokenClass _tokenClass,
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
        CollateralToken.Data storage token = CollateralTokens.get(_tokenClass, _token);
        token.minCollateralRatioBIPS = _minCollateralRatioBIPS.toUint32();
        token.ccbMinCollateralRatioBIPS = _ccbMinCollateralRatioBIPS.toUint32();
        token.safetyMinCollateralRatioBIPS = _safetyMinCollateralRatioBIPS.toUint32();
        emit AMEvents.CollateralTokenRatiosChanged(uint8(_tokenClass), address(_token),
            _minCollateralRatioBIPS, _ccbMinCollateralRatioBIPS, _safetyMinCollateralRatioBIPS);
    }

    function deprecate(
        IAssetManager.CollateralTokenClass _tokenClass,
        IERC20 _token,
        uint256 _invalidationTimeSec
    )
        external
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        CollateralToken.Data storage token = CollateralTokens.get(_tokenClass, _token);
        require(isValid(token), "token not valid");
        require(_invalidationTimeSec >= settings.tokenInvalidationTimeMinSeconds, "deprecation time to short");
        uint256 validUntil = block.timestamp + _invalidationTimeSec;
        token.validUntil = validUntil.toUint64();
        emit AMEvents.CollateralTokenDeprecated(uint8(_tokenClass), address(_token), validUntil);
    }

    function setPoolCollateralToken(
        IAssetManager.CollateralTokenInfo memory _data
    )
        external
    {
        require(_data.tokenClass == IAssetManager.CollateralTokenClass.POOL, "not a pool collateral");
        uint256 index = _add(_data);
        _setPoolCollateralTokenIndex(index);
    }

    function getInfo(
        IAssetManager.CollateralTokenClass _tokenClass,
        IERC20 _token
    )
        external view
        returns (IAssetManager.CollateralTokenInfo memory)
    {
        CollateralToken.Data storage token = CollateralTokens.get(_tokenClass, _token);
        return _getInfo(token);
    }

    function getAllTokenInfos()
        external view
        returns (IAssetManager.CollateralTokenInfo[] memory _result)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 length = state.collateralTokens.length;
        _result = new IAssetManager.CollateralTokenInfo[](length);
        for (uint256 i = 0; i < length; i++) {
            _result[i] = _getInfo(state.collateralTokens[i]);
        }
    }

    function get(
        IAssetManager.CollateralTokenClass _tokenClass,
        IERC20 _token
    )
        internal view
        returns (CollateralToken.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 index = state.collateralTokenIndex[_tokenKey(_tokenClass, _token)];
        require(index > 0, "unknown token");
        return state.collateralTokens[index - 1];
    }

    function getIndex(
        IAssetManager.CollateralTokenClass _tokenClass,
        IERC20 _token
    )
        internal view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 index = state.collateralTokenIndex[_tokenKey(_tokenClass, _token)];
        require(index > 0, "unknown token");
        return index - 1;
    }

    function tryGetIndex(
        IAssetManager.CollateralTokenClass _tokenClass,
        IERC20 _token
    )
        internal view
        returns (bool _isCollateralToken, uint256 _index)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 index = state.collateralTokenIndex[_tokenKey(_tokenClass, _token)];
        _isCollateralToken = index > 0;
        _index = _isCollateralToken ? index - 1 : 0;
    }

    function isValid(CollateralToken.Data storage _token)
        internal view
        returns (bool)
    {
        return _token.validUntil == 0 || _token.validUntil > block.timestamp;
    }

    function _add(IAssetManager.CollateralTokenInfo memory _data) private returns (uint256) {
        AssetManagerState.State storage state = AssetManagerState.get();
        // validation of tokenClass is done before call to _add
        require(address(_data.token) != address(0), "token zero");
        bytes32 tokenKey = _tokenKey(_data.tokenClass, _data.token);
        require(state.collateralTokenIndex[tokenKey] == 0, "token already exists");
        require(_data.validUntil == 0, "cannot add deprecated token");
        bool ratiosValid =
            SafePct.MAX_BIPS < _data.ccbMinCollateralRatioBIPS &&
            _data.ccbMinCollateralRatioBIPS <= _data.minCollateralRatioBIPS &&
            _data.minCollateralRatioBIPS <= _data.safetyMinCollateralRatioBIPS;
        require(ratiosValid, "invalid collateral ratios");
        uint256 newTokenIndex = state.collateralTokens.length;
        state.collateralTokens.push(CollateralToken.Data({
            token: _data.token,
            tokenClass: _data.tokenClass,
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
        emit AMEvents.CollateralTokenAdded(uint8(_data.tokenClass), address(_data.token), _data.decimals,
            _data.directPricePair, _data.assetFtsoSymbol, _data.tokenFtsoSymbol,
            _data.minCollateralRatioBIPS, _data.ccbMinCollateralRatioBIPS, _data.safetyMinCollateralRatioBIPS);
        return newTokenIndex;
    }

    function _setPoolCollateralTokenIndex(uint256 _index) private {
        AssetManagerState.State storage state = AssetManagerState.get();
        CollateralToken.Data storage token = state.collateralTokens[_index];
        require(token.tokenClass == IAssetManager.CollateralTokenClass.POOL, "not a pool collateral token");
        state.poolCollateralIndex = _index.toUint16();
    }

    function _getInfo(CollateralToken.Data storage token)
        private view
        returns (IAssetManager.CollateralTokenInfo memory)
    {
        return IAssetManager.CollateralTokenInfo({
            token: token.token,
            tokenClass: token.tokenClass,
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
        IAssetManager.CollateralTokenClass _tokenClass,
        IERC20 _token
    )
        private pure
        returns (bytes32)
    {
        return bytes32((uint256(_tokenClass) << 160) | uint256(uint160(address(_token))));
    }
}
