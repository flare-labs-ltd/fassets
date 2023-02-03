// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interface/IAgentVault.sol";
import "../../utils/lib/SafeBips.sol";
import "./Agents.sol";
import "./Conversion.sol";
import "./AssetManagerState.sol";
import "./AssetManagerSettings.sol";


library AgentCollateral {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using SafePct for uint256;
    
    enum CollateralKind {
        NOT_REQUIRED,
        CLASS1,
        CLASS2,
        POOL
    }
    
    struct CollateralData {
        CollateralKind kind;
        uint256 fullCollateral;
        uint256 amgToTokenPrice;
    }
    
    struct Data {
        CollateralData collateral1;
        CollateralData collateral2;
        CollateralData poolCollateral;
    }
    
    function currentData(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault
    )
        internal view
        returns (AgentCollateral.Data memory)
    {
        return AgentCollateral.Data({
            collateral1: _getCollateralData(_state, _agentVault, _agent.collateralClass1, CollateralKind.CLASS1),
            collateral2: _getCollateralData(_state, _agentVault, _agent.collateralClass2, CollateralKind.CLASS2),
            poolCollateral: _getCollateralData(_state, address(_agent.collateralPool), 1, CollateralKind.POOL)
        });
    }
    
    function _getCollateralData(
        AssetManagerState.State storage _state,
        address _holderAddress,
        uint256 _type,
        CollateralKind _kind
    )
        private view
        returns (CollateralData memory)
    {
        bool required = true;
        if (_kind == CollateralKind.CLASS1) {
            required = _state.settings.collateral1Required;
        } else if (_kind == CollateralKind.CLASS2) {
            required = _state.settings.collateral2Required;
        }
        if (_type != 0) {
            AssetManagerSettings.TokenClass storage collateral = _state.settings.collateralTypes[_type - 1];
            return CollateralData({ 
                fullCollateral: collateral.token.balanceOf(_holderAddress),
                amgToTokenPrice: Conversion.currentAmgPriceInTokenWei(_state.settings, collateral)
            });
        } else {
            return CollateralData({ fullCollateral: 0, amgToTokenPrice: 0 });
        }
    }
    
    function freeCollateralLots(
        AgentCollateral.Data memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        uint256 freeCollateral = freeCollateralWei(_data, _agent, _settings);
        uint256 lotCollateral = mintingLotCollateralWei(_data, _agent, _settings);
        return freeCollateral / lotCollateral;
    }
    
    function _freeCollateralLots(
        AgentCollateral.CollateralData memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        if (_data.kind == CollateralKind.NOT_REQUIRED) {
            return 0;
        }
        uint256 freeCollateral = _freeCollateralWei(_data, _agent, _settings);
        uint256 lotCollateral = _mintingLotCollateralWei(_data, _agent, _settings);
        return freeCollateral / lotCollateral;
    }

    function freeCollateralWei(
        AgentCollateral.Data memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        uint256 lockedCollateral = lockedCollateralWei(_data, _agent, _settings);
        (, uint256 freeCollateral) = _data.fullCollateral.trySub(lockedCollateral);
        return freeCollateral;
    }

    function _freeCollateralWei(
        AgentCollateral.CollateralData memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        if (_data.kind == CollateralKind.NOT_REQUIRED) {
            return 0;
        }
        uint256 lockedCollateral = _lockedCollateralWei(_data, _agent, _settings);
        (, uint256 freeCollateral) = _data.fullCollateral.trySub(lockedCollateral);
        return freeCollateral;
    }
    
    // Amount of collateral NOT available for new minting or withdrawal.
    function lockedCollateralWei(
        AgentCollateral.Data memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        // agentMinCollateralRatioBIPS must be greater than minCollateralRatioBIPS when set, but
        // minCollateralRatioBIPS can change later so we always use the max of both
        uint256 minCollateralRatio = Math.max(_agent.agentMinCollateralRatioBIPS, _settings.minCollateralRatioBIPS);
        uint256 mintingAMG = uint256(_agent.reservedAMG) + uint256(_agent.mintedAMG);
        uint256 mintingCollateral = Conversion.convertAmgToNATWei(mintingAMG, _data.amgToNATWeiPrice)
            .mulBips(minCollateralRatio);
        uint256 redeemingCollateral = Conversion.convertAmgToNATWei(_agent.redeemingAMG, _data.amgToNATWeiPrice)
            .mulBips(_settings.minCollateralRatioBIPS);
        return mintingCollateral + redeemingCollateral + _agent.withdrawalAnnouncedNATWei;
    }

    // Amount of collateral NOT available for new minting or withdrawal.
    function _lockedCollateralWei(
        AgentCollateral.CollateralData memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        // agentMinCollateralRatioBIPS must be greater than minCollateralRatioBIPS when set, but
        // minCollateralRatioBIPS can change later so we always use the max of both
        uint256 minCollateralRatio = Math.max(_agent.agentMinCollateralRatioBIPS, _settings.minCollateralRatioBIPS);
        uint256 mintingAMG = uint256(_agent.reservedAMG) + uint256(_agent.mintedAMG);
        uint256 mintingCollateral = Conversion.convertAmgToNATWei(mintingAMG, _data.amgToNATWeiPrice)
            .mulBips(minCollateralRatio);
        uint256 redeemingCollateral = Conversion.convertAmgToNATWei(_agent.redeemingAMG, _data.amgToNATWeiPrice)
            .mulBips(_settings.minCollateralRatioBIPS);
        return mintingCollateral + redeemingCollateral + _agent.withdrawalAnnouncedNATWei;
    }

    function mintingLotCollateralWei(
        AgentCollateral.Data memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    ) 
        internal view 
        returns (uint256) 
    {
        uint256 minCollateralRatio = Math.max(_agent.agentMinCollateralRatioBIPS, _settings.minCollateralRatioBIPS);
        return Conversion.convertAmgToNATWei(_settings.lotSizeAMG, _data.amgToNATWeiPrice)
            .mulBips(minCollateralRatio);
    }
    
    // Used for redemption default payment - calculate all types of collateral at the same rate, so that
    // future redemptions don't get less than this one (unless the price changes).
    // Ignores collateral announced for withdrawal (redemption has priority over withdrawal).
    function maxRedemptionCollateral(
        AgentCollateral.Data memory _data,
        Agents.Agent storage _agent, 
        uint256 _valueAMG
    )
        internal view 
        returns (uint256) 
    {
        assert(_agent.redeemingAMG > 0 && _valueAMG <= _agent.redeemingAMG);
        uint256 totalAMG = uint256(_agent.mintedAMG) + uint256(_agent.reservedAMG) + uint256(_agent.redeemingAMG);
        return _data.fullCollateral.mulDiv(_valueAMG, totalAMG); // totalAMG > 0 (guarded by assert)
    }
    
    // Agent's collateral ratio (BIPS) - used in liquidation.
    // Ignores collateral announced for withdrawal (withdrawals are forbidden during liquidation).
    function collateralRatioBIPS(
        Agents.Agent storage _agent, 
        uint256 _fullCollateral,
        uint256 _amgToNATWeiPrice
    )
        internal view
        returns (uint256) 
    {
        uint256 totalAMG = uint256(_agent.mintedAMG) + uint256(_agent.reservedAMG) + uint256(_agent.redeemingAMG);
        if (totalAMG == 0) return type(uint256).max;    // nothing minted - ~infinite collateral ratio
        uint256 backingNATWei = Conversion.convertAmgToNATWei(totalAMG, _amgToNATWeiPrice);
        return _fullCollateral.mulDiv(SafeBips.MAX_BIPS, backingNATWei);
    }
}
