// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../utils/implementation/NativeTokenBurner.sol";
import "../../utils/lib/SafeMath64.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Globals.sol";
import "./Conversion.sol";
import "./CollateralTokens.sol";

library Agents {
    using SafeCast for uint256;
    using Agent for Agent.State;

    function setAgentMinClass1CollateralRatioBIPS(
        Agent.State storage _agent,
        uint256 _minClass1CollateralRatioBIPS
    )
        internal
    {
        CollateralToken.Data storage collateral = getClass1Collateral(_agent);
        require(_minClass1CollateralRatioBIPS >= collateral.minCollateralRatioBIPS,
            "collateral ratio too small");
        _agent.minClass1CollateralRatioBIPS = _minClass1CollateralRatioBIPS.toUint32();
    }

    function setAgentMinPoolCollateralRatioBIPS(
        Agent.State storage _agent,
        uint256 _minPoolCollateralRatioBIPS
    )
        internal
    {
        CollateralToken.Data storage collateral = getPoolCollateral(_agent);
        require(_minPoolCollateralRatioBIPS >= collateral.minCollateralRatioBIPS,
            "collateral ratio too small");
        _agent.minPoolCollateralRatioBIPS = _minPoolCollateralRatioBIPS.toUint32();
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
        CollateralToken.Data storage collateral = getClass1Collateral(_agent);
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
        // don't want the calling method to fail due to too small balance for payout
        uint256 poolBalance = Globals.getWNat().balanceOf(address(_agent.collateralPool));
        _amountPaid = Math.min(_amountWei, poolBalance);
        _agentResponsibilityWei = Math.min(_agentResponsibilityWei, _amountPaid);
        _agent.collateralPool.payout(_receiver, _amountPaid, _agentResponsibilityWei);
    }

    function burnCollateralClass1(
        Agent.State storage _agent,
        uint256 _amountNATWei
    )
        internal
    {
        // TODO: we don't want to burn (lock) stablecoins, should we put them on market for
        // flares and then burn flares?
    }

    function burnCollateralNAT(
        Agent.State storage _agent,
        uint256 _amountNATWei
    )
        internal
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        IAgentVault vault = IAgentVault(_agent.vaultAddress());
        if (settings.burnWithSelfDestruct) {
            // burn by self-destructing a temporary burner contract
            NativeTokenBurner burner = new NativeTokenBurner(settings.burnAddress);
            vault.payoutNAT(Globals.getWNat(), payable(address(burner)), _amountNATWei);
            burner.die();
        } else {
            // burn directly to burn address
            vault.payoutNAT(Globals.getWNat(), settings.burnAddress, _amountNATWei);
        }
    }

    function setClass1Collateral(
        Agent.State storage _agent,
        string memory _tokenIdentifier
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 tokenIndex = CollateralTokens.getIndex(_tokenIdentifier);
        CollateralToken.Data storage token = state.collateralTokens[tokenIndex];
        require(token.tokenClass == IAssetManager.CollateralTokenClass.CLASS1, "not class1 collateral token");
        require(CollateralTokens.isValid(token), "token not valid");
        _agent.class1CollateralToken = tokenIndex.toUint16();
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
        return _token == Globals.getWNat() || _token == getClass1Token(_agent);
    }

    function getClass1Token(Agent.State storage _agent)
        internal view
        returns (IERC20)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[_agent.class1CollateralToken].token;
    }

    function getClass1Collateral(Agent.State storage _agent)
        internal view
        returns (CollateralToken.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[_agent.class1CollateralToken];
    }

    function getPoolCollateral(Agent.State storage _agent)
        internal view
        returns (CollateralToken.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[_agent.poolCollateralToken];
    }

    function class1CollateralUnderwater(Agent.State storage _agent)
        internal view
        returns (bool)
    {
        return (_agent.collateralsUnderwater & Agent.LF_CLASS1) != 0;
    }

    function poolCollateralUnderwater(Agent.State storage _agent)
        internal view
        returns (bool)
    {
        return (_agent.collateralsUnderwater & Agent.LF_POOL) != 0;
    }
}
