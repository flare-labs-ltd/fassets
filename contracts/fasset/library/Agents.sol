// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../utils/implementation/NativeTokenBurner.sol";
import "../../utils/lib/SafeMath64.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Conversion.sol";

library Agents {
    using SafeCast for uint256;
    using AssetManagerState for AssetManagerState.State;
    using Agent for Agent.State;
    
    function setAgentMinCollateralRatioBIPS(
        Agent.State storage _agent,
        uint256 _agentMinCollateralRatioBIPS
    )
        internal
    {
        // TODO: add min pool collateral
        AssetManagerState.State storage state = AssetManagerState.get();
        CollateralToken.Data storage collateral = state.getClass1Collateral(_agent);
        require(_agentMinCollateralRatioBIPS >= collateral.minCollateralRatioBIPS,
            "collateral ratio too small");
        _agent.agentMinCollateralRatioBIPS = _agentMinCollateralRatioBIPS.toUint32();
    }
    
    function allocateMintedAssets(
        Agent.State storage _agent,
        uint64 _valueAMG
    )
        internal
    {
        _agent.mintedAMG = _agent.mintedAMG + _valueAMG;
    }

    function releaseMintedAssets(
        Agent.State storage _agent,
        uint64 _valueAMG
    )
        internal
    {
        _agent.mintedAMG = SafeMath64.sub64(_agent.mintedAMG, _valueAMG, "not enough minted");
    }

    function startRedeemingAssets(
        Agent.State storage _agent,
        uint64 _valueAMG
    )
        internal
    {
        _agent.redeemingAMG = _agent.redeemingAMG + _valueAMG;
        _agent.mintedAMG = SafeMath64.sub64(_agent.mintedAMG, _valueAMG, "not enough minted");
    }

    function endRedeemingAssets(
        Agent.State storage _agent,
        uint64 _valueAMG
    )
        internal
    {
        _agent.redeemingAMG = SafeMath64.sub64(_agent.redeemingAMG, _valueAMG, "not enough redeeming");
    }
    
    function changeDust(
        Agent.State storage _agent,
        uint64 _newDustAMG
    )
        internal
    {
        _agent.dustAMG = _newDustAMG;
        uint256 dustUBA = Conversion.convertAmgToUBA(_newDustAMG);
        emit AMEvents.DustChanged(_agent.vaultAddress(), dustUBA);
    }

    function increaseDust(
        Agent.State storage _agent,
        uint64 _dustIncreaseAMG
    )
        internal
    {
        uint64 newDustAMG = _agent.dustAMG + _dustIncreaseAMG;
        _agent.dustAMG = newDustAMG;
        uint256 dustUBA = Conversion.convertAmgToUBA(newDustAMG);
        emit AMEvents.DustChanged(_agent.vaultAddress(), dustUBA);
    }

    function decreaseDust(
        Agent.State storage _agent,
        uint64 _dustDecreaseAMG
    )
        internal
    {
        uint64 newDustAMG = SafeMath64.sub64(_agent.dustAMG, _dustDecreaseAMG, "not enough dust");
        _agent.dustAMG = newDustAMG;
        uint256 dustUBA = Conversion.convertAmgToUBA(newDustAMG);
        emit AMEvents.DustChanged(_agent.vaultAddress(), dustUBA);
    }
    
    function payoutClass1(
        Agent.State storage _agent,
        address _receiver,
        uint256 _amountWei
    )
        internal
        returns (uint256 _amountPaid)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        CollateralToken.Data storage collateral = state.getClass1Collateral(_agent);
        // don't want the calling method to fail due to too small balance for payout
        IAgentVault vault = IAgentVault(_agent.vaultAddress());
        _amountPaid = Math.min(_amountWei, collateral.token.balanceOf(address(vault)));
        vault.payout(collateral.token, _receiver, _amountPaid);
    }

    function payoutFromPool(
        Agent.State storage _agent,
        address _receiver,
        uint256 _amountWei,
        uint256 _agentResponsibilityWei
    )
        internal
        returns (uint256 _amountPaid)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // don't want the calling method to fail due to too small balance for payout
        _amountPaid = Math.min(_amountWei, state.getWNat().balanceOf(address(_agent.collateralPool)));
        _agentResponsibilityWei = Math.min(_agentResponsibilityWei, _amountPaid);
        _agent.collateralPool.payout(_receiver, _amountPaid, _agentResponsibilityWei);
    }
    
    function burnCollateral(
        Agent.State storage _agent,
        uint256 _amountNATWei
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        IAgentVault vault = IAgentVault(_agent.vaultAddress());
        if (state.settings.burnWithSelfDestruct) {
            // burn by self-destructing a temporary burner contract
            NativeTokenBurner burner = new NativeTokenBurner(state.settings.burnAddress);
            vault.payoutNAT(state.getWNat(), payable(address(burner)), _amountNATWei);
            burner.die();
        } else {
            // burn directly to burn address
            vault.payoutNAT(state.getWNat(), state.settings.burnAddress, _amountNATWei);
        }
    }
    
    function vaultOwner(
        Agent.State storage _agent
    )
        internal view
        returns (address)
    {
        return IAgentVault(_agent.vaultAddress()).owner();
    }

    function requireAgentVaultOwner(
        address _agentVault
    )
        internal view
    {
        address owner = IAgentVault(_agentVault).owner();
        require(msg.sender == owner, "only agent vault owner");
    }
    
    function requireAgentVaultOwner(
        Agent.State storage _agent
    )
        internal view
    {
        address owner = IAgentVault(_agent.vaultAddress()).owner();
        require(msg.sender == owner, "only agent vault owner");
    }
    
    function isCollateralToken(
        Agent.State storage _agent,
        IERC20 _token
    ) 
        internal view 
        returns (bool)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return _token == state.getWNat() || _token == state.getClass1Token(_agent);
    }
}
