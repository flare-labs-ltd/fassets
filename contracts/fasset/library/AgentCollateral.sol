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
    using AssetManagerState for AssetManagerState.State;
    
    struct CollateralData {
        uint256 collateralType;
        uint256 fullCollateral;
        uint256 amgToTokenWeiPrice;
    }
    
    struct Data {
        CollateralData agentCollateral;
        CollateralData poolCollateral;
        uint256 agentPoolTokensEquivWei;
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
            agentCollateral: getSingleCollateralData(_state, _agentVault, _agent.collateralClass),
            poolCollateral: getSingleCollateralData(_state, address(_agent.collateralPool), 0),
            agentPoolTokensEquivWei: getAgentPoolTokensEquivWei(_state, _agent, _agentVault)
        });
    }
    
    function getSingleCollateralData(
        AssetManagerState.State storage _state,
        address _holderAddress,
        uint256 _collateralType
    )
        internal view
        returns (CollateralData memory)
    {
        AssetManagerSettings.CollateralType storage collateral = _state.settings.collateralTypes[_collateralType];
        return CollateralData({ 
            collateralType: _collateralType,
            fullCollateral: collateral.token.balanceOf(_holderAddress),
            amgToTokenWeiPrice: Conversion.currentAmgPriceInTokenWei(_state.settings, collateral)
        });
    }
    
    function getAgentPoolTokensEquivWei(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault
    )
        internal view
        returns (uint256)
    {
        IERC20 poolToken = _agent.collateralPool.poolToken();
        uint256 agentPoolTokens = poolToken.balanceOf(_agentVault);
        uint256 totalPoolTokens = poolToken.totalBalance();
        uint256 poolWNats = _state.getWNat().balanceOf(_agent.collateralPool);
        return agentPoolTokens != 0 ? agentPoolTokens.mulDiv(poolWNats, totalPoolTokens) : 0;
    }
    
    function freeCollateralLots(
        AgentCollateral.Data memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        uint256 freeAgentCollateral = freeSingleCollateralWei(_data.agentCollateral, _agent, _settings);
        if (freeAgentCollateral > _data.agentPoolTokensEquivWei) {
            freeAgentCollateral = _data.agentPoolTokensEquivWei;
        }
        uint256 agentCollateralLot = mintingLotCollateralWei(_data.agentCollateral, _agent, _settings);
        uint256 freePoolCollateral = freeSingleCollateralWei(_data.poolCollateral, _agent, _settings);
        uint256 poolCollateralLot = mintingLotCollateralWei(_data.poolCollateral, _agent, _settings);
        return Math.min(freeAgentCollateral / agentCollateralLot, freePoolCollateral / poolCollateralLot);
    }
    
    function freeSingleCollateralWei(
        AgentCollateral.CollateralData memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        uint256 lockedCollateral = lockedSingleCollateralWei(_data, _agent, _settings);
        (, uint256 freeCollateral) = _data.fullCollateral.trySub(lockedCollateral);
        return freeCollateral;
    }
    
    // Amount of collateral NOT available for new minting or withdrawal.
    function lockedSingleCollateralWei(
        AgentCollateral.CollateralData memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        (uint256 mintingMinCollateralRatioBIPS, uint256 systemMinCollateralRatioBIPS) = 
            mintingMinCollateralRatio(_agent, _settings, _data.collateralType);
        uint256 mintingAMG = uint256(_agent.reservedAMG) + uint256(_agent.mintedAMG);
        uint256 mintingCollateral = Conversion.convertAmgToTokenWei(mintingAMG, _data.amgToTokenWeiPrice)
            .mulBips(mintingMinCollateralRatioBIPS);
        uint256 redeemingCollateral = Conversion.convertAmgToTokenWei(_agent.redeemingAMG, _data.amgToTokenWeiPrice)
            .mulBips(systemMinCollateralRatioBIPS);
        return mintingCollateral + redeemingCollateral + _agent.withdrawalAnnouncedNATWei;
    }

    function mintingLotCollateralWei(
        AgentCollateral.CollateralData memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    ) 
        internal view 
        returns (uint256) 
    {
        (uint256 minCollateralRatio,) = mintingMinCollateralRatio(_agent, _settings, _data.collateralType);
        return Conversion.convertAmgToTokenWei(_settings.lotSizeAMG, _data.amgToTokenWeiPrice)
            .mulBips(minCollateralRatio);
    }
    
    function mintingMinCollateralRatio(
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings,
        uint256 _collateralType
    )
        internal view
        returns (uint256 _mintingMinCollateralRatioBIPS, uint256 _systemMinCollateralRatioBIPS)
    {
        AssetManagerSettings.CollateralType storage collateral = _settings.collateralTypes[_collateralType];
        // Ony one collateralType corresponds to pool collateral
        uint256 agentMinCollateralRatioBIPS = _collateralType == AssetManagerSettings.POOL_COLLATERAL ?
            _agent.agentMinPoolCollateralRatioBIPS : _agent.agentMinCollateralRatioBIPS;
        // agentMinCollateralRatioBIPS must be greater than minCollateralRatioBIPS when set, but
        // minCollateralRatioBIPS can change later so we always use the max of both
        _systemMinCollateralRatioBIPS = collateral.minCollateralRatioBIPS;
        _mintingMinCollateralRatioBIPS = Math.max(agentMinCollateralRatioBIPS, _systemMinCollateralRatioBIPS);
    }
    
    // Used for redemption default payment - calculate all types of collateral at the same rate, so that
    // future redemptions don't get less than this one (unless the price changes).
    // Ignores collateral announced for withdrawal (redemption has priority over withdrawal).
    function maxRedemptionSingleCollateral(
        AgentCollateral.CollateralData memory _data,
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
        uint256 _amgToTokenWeiPrice
    )
        internal view
        returns (uint256) 
    {
        uint256 totalAMG = uint256(_agent.mintedAMG) + uint256(_agent.reservedAMG) + uint256(_agent.redeemingAMG);
        if (totalAMG == 0) return type(uint256).max;    // nothing minted - ~infinite collateral ratio
        uint256 backingNATWei = Conversion.convertAmgToTokenWei(totalAMG, _amgToTokenWeiPrice);
        return _fullCollateral.mulDiv(SafeBips.MAX_BIPS, backingNATWei);
    }
}
