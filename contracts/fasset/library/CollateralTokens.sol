// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";


library CollateralTokens {
    using SafeCast for uint256;

    struct TokenInfo {
        // Identifier used to access token for updating or getting info.
        string identifier;

        // The ERC20 token contract for this collateral type.
        IERC20 token;

        // The kind of collateral for this token.
        CollateralToken.TokenClass tokenClass;

        // Same as token.decimals(), when that exists.
        uint256 decimals;

        // Token invalidation time. Must be 0 on creation.
        uint256 validUntil;

        // FTSO symbol for token.
        string ftsoSymbol;

        // Minimum collateral ratio for healthy agents.
        uint256 minCollateralRatioBIPS;

        // Minimum collateral ratio for agent in CCB (Collateral call band).
        // If the agent's collateral ratio is less than this, skip the CCB and go straight to liquidation.
        // A bit smaller than minCollateralRatioBIPS.
        uint256 ccbMinCollateralRatioBIPS;

        // Minimum collateral ratio required to get agent out of liquidation.
        // Wiil always be greater than minCollateralRatioBIPS.
        uint256 safetyMinCollateralRatioBIPS;
    }

    function add(CollateralTokens.TokenInfo calldata _data) external {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(state.collateralTokenIndex[_data.identifier] == 0, "token already exists");
        require(_data.validUntil == 0, "cannot add deprecated token");
        bool ratiosValid = _data.ccbMinCollateralRatioBIPS <= _data.minCollateralRatioBIPS &&
            _data.minCollateralRatioBIPS <= _data.safetyMinCollateralRatioBIPS;
        require(ratiosValid, "invalid collateral ratios");
        uint256 ftsoIndex = state.settings.ftsoRegistry.getFtsoIndex(_data.ftsoSymbol);
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
        state.collateralTokenIndex[_data.identifier] = state.collateralTokens.length;   // = index + 1
        emit AMEvents.CollateralTokenAdded(_data.identifier,
            address(_data.token), uint8(_data.tokenClass), _data.ftsoSymbol,
            _data.minCollateralRatioBIPS, _data.ccbMinCollateralRatioBIPS, _data.safetyMinCollateralRatioBIPS);
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
        uint256 _timeout
    )
        external
    {
        CollateralToken.Data storage token = CollateralTokens.get(_identifier);
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        require(isValid(token), "token not valid");
        require(_timeout >= settings.tokenDeprecationTimeoutMinSeconds, "deprecation time to short");
        uint256 validUntil = block.timestamp + _timeout;
        token.validUntil = validUntil.toUint64();
        emit AMEvents.CollateralTokenDeprecated(_identifier, validUntil);
    }

    function getInfo(string memory _identifier)
        external view
        returns (TokenInfo memory)
    {
        CollateralToken.Data storage token = CollateralTokens.get(_identifier);
        return TokenInfo({
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

    function get(string memory _identifier)
        internal view
        returns (CollateralToken.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 index = state.collateralTokenIndex[_identifier];
        require(index > 0, "unknown token");
        return state.collateralTokens[index - 1];
    }

    function isValid(CollateralToken.Data storage _token)
        internal view
        returns (bool)
    {
        return _token.validUntil == 0 || _token.validUntil > block.timestamp;
    }
}
