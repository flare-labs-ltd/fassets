// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

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
    
    struct Data {
        uint256 fullCollateral;
        uint256 amgToNATWeiPrice;
    }
    
    function currentData(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        internal view
        returns (AgentCollateral.Data memory)
    {
        return AgentCollateral.Data({
            fullCollateral: _state.settings.wNat.balanceOf(_agentVault),
            amgToNATWeiPrice: Conversion.currentAmgToNATWeiPrice(_state.settings)
        });
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
    
    // Amount of collateral NOT available for new minting.
    function lockedCollateralWei(
        AgentCollateral.Data memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view 
        returns (uint256) 
    {
        uint256 mintingAMG = uint256(_agent.reservedAMG) + uint256(_agent.mintedAMG);
        uint256 mintingCollateral = Conversion.convertAmgToNATWei(mintingAMG, _data.amgToNATWeiPrice)
            .mulBips(_agent.agentMinCollateralRatioBIPS);
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
        return Conversion.convertAmgToNATWei(_settings.lotSizeAMG, _data.amgToNATWeiPrice)
            .mulBips(_agent.agentMinCollateralRatioBIPS);
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
        if (_valueAMG == 0) return 0;
        uint256 totalAMG = uint256(_agent.mintedAMG) + uint256(_agent.reservedAMG) + uint256(_agent.redeemingAMG);
        require(totalAMG >= _valueAMG, "value larger than total");
        return _data.fullCollateral.mulDiv(_valueAMG, totalAMG);
    }
    
    // Agent's collateral ratio - used in liquidation.
    // Reserves CR collateral and redemption collateral at minCollateralRatio,
    // and returns oynly collateral ratio for minted assets.
    // Ignores collateral announced for withdrawal (withdrawals are forbidden during liquidation).
    function collateralRatio(
        AgentCollateral.Data memory _data,
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings
    )
        internal view
        returns (uint256) 
    {
        if (_agent.mintedAMG == 0) return type(uint256).max;    // nothing minted - ~infinite collateral ratio
        // reserve CR collateral and redemption collateral at minCollateralRatio
        uint256 reservedAMG = uint256(_agent.reservedAMG) + uint256(_agent.redeemingAMG); 
        uint256 reservedCollateral = Conversion.convertAmgToNATWei(reservedAMG, _data.amgToNATWeiPrice)
            .mulBips(_settings.minCollateralRatioBIPS);
        (, uint256 availableCollateral) = _data.fullCollateral.trySub(reservedCollateral);
        // calculate NATWei value of minted assets
        uint256 backingNATWei = Conversion.convertAmgToNATWei(_agent.mintedAMG, _data.amgToNATWeiPrice);
        return availableCollateral.mulDiv(SafeBips.MAX_BIPS, backingNATWei);
    }
}
