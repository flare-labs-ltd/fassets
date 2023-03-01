// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";


library CollateralTokens {
    using SafeCast for uint256;

    function add(IAssetManager.CollateralTokenInfo calldata _data) external {
        _add(_data);
    }

    function setCollateralRatios(
        string memory _identifier,
        uint256 _minCollateralRatioBIPS,
        uint256 _ccbMinCollateralRatioBIPS,
        uint256 _safetyMinCollateralRatioBIPS
    )
        external
    {
        bool ratiosValid = _ccbMinCollateralRatioBIPS <= _minCollateralRatioBIPS &&
            _minCollateralRatioBIPS <= _safetyMinCollateralRatioBIPS;
        require(ratiosValid, "invalid collateral ratios");
        // update
        CollateralToken.Data storage token = CollateralTokens.get(_identifier);
        token.minCollateralRatioBIPS = _minCollateralRatioBIPS.toUint32();
        token.ccbMinCollateralRatioBIPS = _ccbMinCollateralRatioBIPS.toUint32();
        token.safetyMinCollateralRatioBIPS = _safetyMinCollateralRatioBIPS.toUint32();
        emit AMEvents.CollateralTokenRatiosChanged(_identifier,
            _minCollateralRatioBIPS, _ccbMinCollateralRatioBIPS, _safetyMinCollateralRatioBIPS);
    }

    function deprecate(
        string memory _identifier,
        uint256 _invalidationTimeSec
    )
        external
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        CollateralToken.Data storage token = CollateralTokens.get(_identifier);
        require(isValid(token), "token not valid");
        require(_invalidationTimeSec >= settings.tokenInvalidationTimeMinSeconds, "deprecation time to short");
        uint256 validUntil = block.timestamp + _invalidationTimeSec;
        token.validUntil = validUntil.toUint64();
        emit AMEvents.CollateralTokenDeprecated(_identifier, validUntil);
    }

    function setCurrentPoolCollateralToken(IAssetManager.CollateralTokenInfo calldata _data) external {
        require(_data.tokenClass == IAssetManager.CollateralTokenClass.POOL, "not a pool collateral");
        _add(_data);
        _setCurrentPoolCollateralToken(_data.identifier);
    }

    function getInfo(string memory _identifier)
        external view
        returns (IAssetManager.CollateralTokenInfo memory)
    {
        CollateralToken.Data storage token = CollateralTokens.get(_identifier);
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

    function get(string memory _identifier)
        internal view
        returns (CollateralToken.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 index = state.collateralTokenIndex[_identifier];
        require(index > 0, "unknown token");
        return state.collateralTokens[index - 1];
    }

    function getIndex(string memory _identifier)
        internal view
        returns (uint256)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 index = state.collateralTokenIndex[_identifier];
        require(index > 0, "unknown token");
        return index - 1;
    }

    function isValid(CollateralToken.Data storage _token)
        internal view
        returns (bool)
    {
        return _token.validUntil == 0 || _token.validUntil > block.timestamp;
    }

    function _add(IAssetManager.CollateralTokenInfo calldata _data) private {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(state.collateralTokenIndex[_data.identifier] == 0, "token already exists");
        require(_data.validUntil == 0, "cannot add deprecated token");
        bool ratiosValid = _data.ccbMinCollateralRatioBIPS <= _data.minCollateralRatioBIPS &&
            _data.minCollateralRatioBIPS <= _data.safetyMinCollateralRatioBIPS;
        require(ratiosValid, "invalid collateral ratios");
        uint256 ftsoIndex = state.settings.ftsoRegistry.getFtsoIndex(_data.ftsoSymbol);
        uint256 newTokenIndex = state.collateralTokens.length;
        state.collateralTokens.push(CollateralToken.Data({
            identifier: _data.identifier,
            token: _data.token,
            tokenClass: _data.tokenClass,
            decimals: _data.decimals.toUint8(),
            ftsoIndex: ftsoIndex.toUint16(),
            validUntil: _data.validUntil.toUint64(),
            ftsoSymbol: _data.ftsoSymbol,
            minCollateralRatioBIPS: _data.minCollateralRatioBIPS.toUint32(),
            ccbMinCollateralRatioBIPS: _data.ccbMinCollateralRatioBIPS.toUint32(),
            safetyMinCollateralRatioBIPS: _data.safetyMinCollateralRatioBIPS.toUint32()
        }));
        state.collateralTokenIndex[_data.identifier] = newTokenIndex + 1;   // 0 means empty
        emit AMEvents.CollateralTokenAdded(_data.identifier,
            address(_data.token), uint8(_data.tokenClass), _data.ftsoSymbol,
            _data.minCollateralRatioBIPS, _data.ccbMinCollateralRatioBIPS, _data.safetyMinCollateralRatioBIPS);
    }

    function _setCurrentPoolCollateralToken(string memory _identifier) private {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 index = CollateralTokens.getIndex(_identifier);
        CollateralToken.Data storage token = state.collateralTokens[index];
        require(token.tokenClass == IAssetManager.CollateralTokenClass.POOL, "not a pool collateral token");
        state.currentPoolCollateralToken = index.toUint16();
    }

    function _getInfo(CollateralToken.Data storage token)
        private view
        returns (IAssetManager.CollateralTokenInfo memory)
    {
        return IAssetManager.CollateralTokenInfo({
            identifier: token.identifier,
            token: token.token,
            tokenClass: token.tokenClass,
            decimals: token.decimals,
            validUntil: token.validUntil,
            ftsoSymbol: token.ftsoSymbol,
            minCollateralRatioBIPS: token.minCollateralRatioBIPS,
            ccbMinCollateralRatioBIPS: token.ccbMinCollateralRatioBIPS,
            safetyMinCollateralRatioBIPS: token.safetyMinCollateralRatioBIPS
        });
    }
}
