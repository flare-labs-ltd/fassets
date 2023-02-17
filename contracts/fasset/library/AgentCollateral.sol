// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interface/IAgentVault.sol";
import "../../utils/lib/SafeBips.sol";
import "./Agents.sol";
import "./Conversion.sol";
import "./data/AssetManagerState.sol";
import "./data/AssetManagerSettings.sol";


library AgentCollateral {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using SafePct for uint256;
    using AssetManagerState for AssetManagerState.State;
    
    enum Kind {
        AGENT_CLASS1,   // class 1 collateral (stablecoins in agent vault)
        POOL,           // pool collateral (NAT)
        AGENT_POOL      // agent's pool tokens (expressed in NAT) - only important for minting
    }
    
    struct CollateralData {
        Kind kind;
        uint256 fullCollateral;
        uint256 amgToTokenWeiPrice;
    }
    
    struct MintingData {
        AgentCollateral.CollateralData agentCollateral;
        AgentCollateral.CollateralData poolCollateral;
        AgentCollateral.CollateralData agentPoolTokens;
    }
    
    function currentData(
        AssetManagerState.State storage _state,
        Agent.State storage _agent,
        address _agentVault
    )
        internal view
        returns (AgentCollateral.MintingData memory)
    {
        AgentCollateral.CollateralData memory poolCollateral = poolCollateralData(_state, _agent);
        return AgentCollateral.MintingData({
            agentCollateral: agentClass1CollateralData(_state, _agent, _agentVault),
            poolCollateral: poolCollateral,
            agentPoolTokens: agentsPoolTokensCollateralData(poolCollateral, _agent, _agentVault)
        });
    }
    
    function agentClass1CollateralData(
        AssetManagerState.State storage _state,
        Agent.State storage _agent,
        address _agentVault
    )
        internal view
        returns (AgentCollateral.CollateralData memory)
    {
        CollateralToken.Data storage collateral = _state.collateralTokens[_agent.collateralTokenC1];
        return AgentCollateral.CollateralData({ 
            kind: Kind.AGENT_CLASS1,
            fullCollateral: collateral.token.balanceOf(_agentVault),
            amgToTokenWeiPrice: Conversion.currentAmgPriceInTokenWei(_state.settings, collateral)
        });
    }
    
    function poolCollateralData(
        AssetManagerState.State storage _state,
        Agent.State storage _agent
    )
        internal view
        returns (AgentCollateral.CollateralData memory)
    {
        CollateralToken.Data storage collateral = _state.collateralTokens[CollateralToken.POOL];
        return AgentCollateral.CollateralData({ 
            kind: Kind.POOL,
            fullCollateral: collateral.token.balanceOf(address(_agent.collateralPool)),
            amgToTokenWeiPrice: Conversion.currentAmgPriceInTokenWei(_state.settings, collateral)
        });
    }
    
    function agentsPoolTokensCollateralData(
        AgentCollateral.CollateralData memory _poolCollateral,
        Agent.State storage _agent,
        address _agentVault
    )
        internal view
        returns (AgentCollateral.CollateralData memory)
    {
        IERC20 poolToken = _agent.collateralPool.poolToken();
        uint256 agentPoolTokens = poolToken.balanceOf(_agentVault);
        uint256 totalPoolTokens = poolToken.totalSupply();
        uint256 amgToPoolTokenWeiPrice = _poolCollateral.fullCollateral != 0 ?
            _poolCollateral.amgToTokenWeiPrice.mulDiv(totalPoolTokens, _poolCollateral.fullCollateral) : 0;
        return AgentCollateral.CollateralData({ 
            kind: Kind.AGENT_POOL,
            fullCollateral: agentPoolTokens,
            amgToTokenWeiPrice: amgToPoolTokenWeiPrice
        });
    }
    
    // The max number of lots the agent can mint
    function freeCollateralLots(
        AgentCollateral.MintingData memory _data,
        AssetManagerState.State storage _state,
        Agent.State storage _agent
    )
        internal view 
        returns (uint256 _lots) 
    {
        uint256 agentLots = freeSingleCollateralLots(_data.agentCollateral, _state, _agent);
        uint256 poolLots = freeSingleCollateralLots(_data.poolCollateral, _state, _agent);
        uint256 agentPoolTokenLots = freeSingleCollateralLots(_data.agentPoolTokens, _state, _agent);
        return Math.min(agentLots, Math.min(poolLots, agentPoolTokenLots));
    }

    function freeSingleCollateralLots(
        AgentCollateral.CollateralData memory _data,
        AssetManagerState.State storage _state,
        Agent.State storage _agent
    )
        internal view 
        returns (uint256) 
    {
        uint256 collateralWei = freeCollateralWei(_data, _state, _agent);
        uint256 lotWei = mintingLotCollateralWei(_data, _state, _agent);
        // lotWei=0 is possible only for agent's pool token collateral if pool balance in NAT is 0
        // so then we can safely return 0 here, since minting is impossible
        return lotWei != 0 ? collateralWei / lotWei : 0;
    }
    
    function freeCollateralWei(
        AgentCollateral.CollateralData memory _data,
        AssetManagerState.State storage _state,
        Agent.State storage _agent
    )
        internal view 
        returns (uint256) 
    {
        uint256 lockedCollateral = lockedCollateralWei(_data, _state, _agent);
        (, uint256 freeCollateral) = _data.fullCollateral.trySub(lockedCollateral);
        return freeCollateral;
    }
    
    // Amount of collateral NOT available for new minting or withdrawal.
    function lockedCollateralWei(
        AgentCollateral.CollateralData memory _data,
        AssetManagerState.State storage _state,
        Agent.State storage _agent
    )
        internal view 
        returns (uint256) 
    {
        (uint256 mintingMinCollateralRatioBIPS, uint256 systemMinCollateralRatioBIPS) = 
            mintingMinCollateralRatio(_state, _agent, _data.kind);
        uint256 backedAMG = uint256(_agent.reservedAMG) + uint256(_agent.mintedAMG);
        uint256 mintingCollateral = Conversion.convertAmgToTokenWei(backedAMG, _data.amgToTokenWeiPrice)
            .mulBips(mintingMinCollateralRatioBIPS);
        uint256 redeemingCollateral = Conversion.convertAmgToTokenWei(_agent.redeemingAMG, _data.amgToTokenWeiPrice)
            .mulBips(systemMinCollateralRatioBIPS);
        return mintingCollateral + redeemingCollateral + _agent.withdrawalAnnouncedNATWei;
    }

    function mintingLotCollateralWei(
        AgentCollateral.CollateralData memory _data,
        AssetManagerState.State storage _state,
        Agent.State storage _agent
    ) 
        internal view 
        returns (uint256) 
    {
        (uint256 minCollateralRatio,) = mintingMinCollateralRatio(_state, _agent, _data.kind);
        return Conversion.convertAmgToTokenWei(_state.settings.lotSizeAMG, _data.amgToTokenWeiPrice)
            .mulBips(minCollateralRatio);
    }
    
    function mintingMinCollateralRatio(
        AssetManagerState.State storage _state,
        Agent.State storage _agent, 
        Kind _kind
    )
        internal view
        returns (uint256 _mintingMinCollateralRatioBIPS, uint256 _systemMinCollateralRatioBIPS)
    {
        if (_kind == Kind.AGENT_POOL) {
            _systemMinCollateralRatioBIPS = _state.settings.mintingPoolHoldingsRequiredBIPS;
            _mintingMinCollateralRatioBIPS = _systemMinCollateralRatioBIPS;
        } else if (_kind == Kind.POOL) {
            _systemMinCollateralRatioBIPS = 
                _state.collateralTokens[CollateralToken.POOL].minCollateralRatioBIPS;
            _mintingMinCollateralRatioBIPS = 
                Math.max(_agent.agentMinPoolCollateralRatioBIPS, _systemMinCollateralRatioBIPS);
        } else {
            _systemMinCollateralRatioBIPS = 
                _state.collateralTokens[_agent.collateralTokenC1].minCollateralRatioBIPS;
            // agentMinCollateralRatioBIPS must be greater than minCollateralRatioBIPS when set, but
            // minCollateralRatioBIPS can change later so we always use the max of both
            _mintingMinCollateralRatioBIPS = 
                Math.max(_agent.agentMinCollateralRatioBIPS, _systemMinCollateralRatioBIPS);
        }
    }
    
    // Used for redemption default payment - calculate all types of collateral at the same rate, so that
    // future redemptions don't get less than this one (unless the price changes).
    // Ignores collateral announced for withdrawal (redemption has priority over withdrawal).
    function maxRedemptionCollateral(
        AgentCollateral.CollateralData memory _data,
        Agent.State storage _agent, 
        uint256 _valueAMG
    )
        internal view 
        returns (uint256) 
    {
        assert(_agent.redeemingAMG > 0 && _valueAMG <= _agent.redeemingAMG);
        uint256 totalAMG = uint256(_agent.mintedAMG) + uint256(_agent.reservedAMG) + uint256(_agent.redeemingAMG);
        return _data.fullCollateral.mulDiv(_valueAMG, totalAMG); // totalAMG > 0 (guarded by assert)
    }
    
    // Used for calculating collateral ration in liquidation.
    function collateralDataWithTrusted(
        AssetManagerState.State storage _state,
        Agent.State storage _agent,
        address _agentVault,
        Kind _kind
    )
        internal view
        returns (uint256 _fullCollateral, uint256 _amgToTokenWeiPrice, uint256 _amgToTokenWeiPriceTrusted)
    {
        assert (_kind != Kind.AGENT_POOL);   // does not make sense for liquidation
        uint256 tokenIndex = 
            _kind == Kind.AGENT_CLASS1 ? _agent.collateralTokenC1 : CollateralToken.POOL;
        CollateralToken.Data storage collateral = _state.collateralTokens[tokenIndex];
        address holderAddress = 
            _kind == Kind.AGENT_CLASS1 ? _agentVault : address(_agent.collateralPool);
        _fullCollateral = collateral.token.balanceOf(holderAddress);
        (_amgToTokenWeiPrice, _amgToTokenWeiPriceTrusted) = 
            Conversion.currentAmgPriceInTokenWeiWithTrusted(_state.settings, collateral);
    }
    
    // Agent's collateral ratio for single collateral type (BIPS) - used in liquidation.
    // Ignores collateral announced for withdrawal (withdrawals are forbidden during liquidation).
    function collateralRatioBIPS(
        Agent.State storage _agent, 
        uint256 _fullCollateral,
        uint256 _amgToTokenWeiPrice
    )
        internal view
        returns (uint256) 
    {
        uint256 totalAMG = uint256(_agent.mintedAMG) + uint256(_agent.reservedAMG) + uint256(_agent.redeemingAMG);
        if (totalAMG == 0) return 1e10;    // nothing minted - ~infinite collateral ratio (but avoid overflows)
        uint256 backingTokenWei = Conversion.convertAmgToTokenWei(totalAMG, _amgToTokenWeiPrice);
        return _fullCollateral.mulDiv(SafeBips.MAX_BIPS, backingTokenWei);
    }
}
