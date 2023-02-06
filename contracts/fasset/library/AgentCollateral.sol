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
    
    enum CollateralKind {
        AGENT_CLASS1,   // class 1 collateral (stablecoins in agent vault)
        POOL,           // pool collateral (NAT)
        AGENT_POOL      // agent's pool tokens (expressed in NAT) - only important for minting
    }
    
    struct CollateralData {
        CollateralKind kind;
        uint256 fullCollateral;
        uint256 amgToTokenWeiPrice;
    }
    
    struct Data {
        CollateralData agentCollateral;
        CollateralData poolCollateral;
        CollateralData agentPoolTokens;
    }
    
    function currentData(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault
    )
        internal view
        returns (AgentCollateral.Data memory)
    {
        CollateralData memory poolCollateral = getPoolCollateralData(_state, _agent);
        return AgentCollateral.Data({
            agentCollateral: getAgentClass1CollateralData(_state, _agent, _agentVault),
            poolCollateral: poolCollateral,
            agentPoolTokens: getAgentPoolTokensCollateralData(poolCollateral, _agent, _agentVault)
        });
    }
    
    function getAgentClass1CollateralData(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent,
        address _agentVault
    )
        internal view
        returns (CollateralData memory)
    {
        AssetManagerSettings.CollateralToken storage collateral = 
            _state.settings.collateralTokens[_agent.collateralTokenC1];
        return CollateralData({ 
            kind: CollateralKind.AGENT_CLASS1,
            fullCollateral: collateral.token.balanceOf(_agentVault),
            amgToTokenWeiPrice: Conversion.currentAmgPriceInTokenWei(_state.settings, collateral)
        });
    }
    
    function getPoolCollateralData(
        AssetManagerState.State storage _state,
        Agents.Agent storage _agent
    )
        internal view
        returns (CollateralData memory)
    {
        AssetManagerSettings.CollateralToken storage collateral = 
            _state.settings.collateralTokens[AssetManagerSettings.POOL_COLLATERAL];
        return CollateralData({ 
            kind: CollateralKind.POOL,
            fullCollateral: collateral.token.balanceOf(address(_agent.collateralPool)),
            amgToTokenWeiPrice: Conversion.currentAmgPriceInTokenWei(_state.settings, collateral)
        });
    }
    
    function getAgentPoolTokensCollateralData(
        CollateralData memory _poolCollateral,
        Agents.Agent storage _agent,
        address _agentVault
    )
        internal view
        returns (uint256)
    {
        IERC20 poolToken = _agent.collateralPool.poolToken();
        uint256 agentPoolTokens = poolToken.balanceOf(_agentVault);
        uint256 totalPoolTokens = poolToken.totalBalance();
        uint256 amgToPoolTokenWeiPrice = _poolCollateral.fullCollateral != 0 ?
            _poolCollateral.amgToTokenWeiPrice.mulDiv(totalPoolTokens, _poolCollateral.fullCollateral) : 0;
        return CollateralData({ 
            kind: CollateralKind.AGENT_POOL,
            fullCollateral: agentPoolTokens,
            amgToTokenWeiPrice: amgToPoolTokenWeiPrice
        });
    }
    
    // The max number of lots the agent can mint
    function freeCollateralLots(
        AgentCollateral.Data memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256 _lots) 
    {
        uint256 agentLots = freeSingleCollateralLots(_data.agentCollateral, _agent, _settings);
        uint256 poolLots = freeSingleCollateralLots(_data.poolCollateral, _agent, _settings);
        uint256 agentPoolTokenLots = freeSingleCollateralLots(_data.agentPoolTokens, _agent, _settings);
        return Math.min(agentLots, Math.min(poolLots, agentPoolTokenLots));
    }

    function freeSingleCollateralLots(
        AgentCollateral.CollateralData memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        uint256 collateralWei = freeSingleCollateralWei(_data, _agent, _settings);
        uint256 lotWei = mintingLotCollateralWei(_data, _agent, _settings);
        // lotWei=0 is possible only for agent's pool token collateral if pool balance in NAT is 0
        // so then we can safely return 0 here, since minting is impossible
        return lotWei != 0 ? collateralWei / lotWei : 0;
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
            mintingMinCollateralRatio(_agent, _settings, _data.collateralKind);
        uint256 backedAMG = uint256(_agent.reservedAMG) + uint256(_agent.mintedAMG);
        uint256 mintingCollateral = Conversion.convertAmgToTokenWei(backedAMG, _data.amgToTokenWeiPrice)
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
        (uint256 minCollateralRatio,) = mintingMinCollateralRatio(_agent, _settings, _data.collateralKind);
        return Conversion.convertAmgToTokenWei(_settings.lotSizeAMG, _data.amgToTokenWeiPrice)
            .mulBips(minCollateralRatio);
    }
    
    function mintingMinCollateralRatio(
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings,
        CollateralKind _kind
    )
        internal view
        returns (uint256 _mintingMinCollateralRatioBIPS, uint256 _systemMinCollateralRatioBIPS)
    {
        if (_kind == CollateralKind.AGENT_POOL) {
            _systemMinCollateralRatioBIPS = _settings.mintingPoolHoldingsRequiredBIPS;
            _mintingMinCollateralRatioBIPS = _systemMinCollateralRatioBIPS;
        } else if (_kind == CollateralKind.POOL) {
            _systemMinCollateralRatioBIPS = 
                _settings.collateralTokens[AssetManagerSettings.POOL_COLLATERAL].minCollateralRatioBIPS;
            _mintingMinCollateralRatioBIPS = 
                Math.max(_agent.agentMinPoolCollateralRatioBIPS, _systemMinCollateralRatioBIPS);
        } else {
            _systemMinCollateralRatioBIPS = 
                _settings.collateralTokens[_agent.collateralTokenC1].minCollateralRatioBIPS;
            // agentMinCollateralRatioBIPS must be greater than minCollateralRatioBIPS when set, but
            // minCollateralRatioBIPS can change later so we always use the max of both
            _mintingMinCollateralRatioBIPS = 
                Math.max(_agent.agentMinCollateralRatioBIPS, _systemMinCollateralRatioBIPS);
        }
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
    
    // Agent's collateral ratio for single collateral type (BIPS) - used in liquidation.
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
