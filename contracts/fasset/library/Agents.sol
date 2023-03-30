// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../utils/implementation/NativeTokenBurner.sol";
import "../../utils/lib/SafeMath64.sol";
import "./data/AssetManagerState.sol";
import "./data/Collateral.sol";
import "./AMEvents.sol";
import "./Globals.sol";
import "./Conversion.sol";
import "./CollateralTokens.sol";
import "./AgentCollateral.sol";

library Agents {
    using SafeCast for uint256;
    using SafePct for uint256;
    using Agent for Agent.State;

    function setMintingClass1CollateralRatioBIPS(
        Agent.State storage _agent,
        uint256 _mintingClass1CollateralRatioBIPS
    )
        internal
    {
        CollateralToken.Data storage collateral = getClass1Collateral(_agent);
        require(_mintingClass1CollateralRatioBIPS >= collateral.minCollateralRatioBIPS,
            "collateral ratio too small");
        _agent.mintingClass1CollateralRatioBIPS = _mintingClass1CollateralRatioBIPS.toUint32();
    }

    function setMintingPoolCollateralRatioBIPS(
        Agent.State storage _agent,
        uint256 _mintingPoolCollateralRatioBIPS
    )
        internal
    {
        CollateralToken.Data storage collateral = getPoolCollateral(_agent);
        require(_mintingPoolCollateralRatioBIPS >= collateral.minCollateralRatioBIPS,
            "collateral ratio too small");
        _agent.mintingPoolCollateralRatioBIPS = _mintingPoolCollateralRatioBIPS.toUint32();
    }

    function setFeeBIPS(
        Agent.State storage _agent,
        uint256 _feeBIPS
    )
        internal
    {
        require(_feeBIPS < SafePct.MAX_BIPS, "fee to high");
        _agent.feeBIPS = _feeBIPS.toUint16();
    }

    function setPoolFeeShareBIPS(
        Agent.State storage _agent,
        uint256 _poolFeeShareBIPS
    )
        internal
    {
        require(_poolFeeShareBIPS < SafePct.MAX_BIPS, "value to high");
        _agent.poolFeeShareBIPS = _poolFeeShareBIPS.toUint16();
    }

    function setBuyFAssetByAgentFactorBIPS(
        Agent.State storage _agent,
        uint256 _buyFAssetByAgentFactorBIPS
    )
        internal
    {
        _agent.buyFAssetByAgentFactorBIPS = _buyFAssetByAgentFactorBIPS.toUint16();
    }

    function setPoolExitCollateralRatioBIPS(
        Agent.State storage _agent,
        uint256 _poolExitCollateralRatioBIPS
    )
        internal
    {
        CollateralToken.Data storage collateral = getPoolCollateral(_agent);
        uint256 minCR = Math.max(_agent.mintingPoolCollateralRatioBIPS, collateral.minCollateralRatioBIPS);
        require(_poolExitCollateralRatioBIPS >= minCR, "value to low");
        _agent.collateralPool.setExitCollateralRatioBIPS(_poolExitCollateralRatioBIPS);
    }

    function setPoolTopupCollateralRatioBIPS(
        Agent.State storage _agent,
        uint256 _poolTopupCollateralRatioBIPS
    )
        internal
    {
        CollateralToken.Data storage collateral = getPoolCollateral(_agent);
        require(_poolTopupCollateralRatioBIPS >= collateral.minCollateralRatioBIPS, "value to low");
        _agent.collateralPool.setTopupCollateralRatioBIPS(_poolTopupCollateralRatioBIPS);
    }

    function setPoolTopupTokenPriceFactorBIPS(
        Agent.State storage _agent,
        uint256 _poolTopupTokenPriceFactorBIPS
    )
        internal
    {
        _agent.collateralPool.setTopupCollateralRatioBIPS(_poolTopupTokenPriceFactorBIPS);
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
        uint64 _valueAMG,
        bool _poolSelfCloseRedemption
    )
        internal
    {
        _agent.redeemingAMG += _valueAMG;
        if (!_poolSelfCloseRedemption) {
            _agent.poolRedeemingAMG += _valueAMG;
        }
        _agent.mintedAMG = SafeMath64.sub64(_agent.mintedAMG, _valueAMG, "not enough minted");
    }

    function endRedeemingAssets(
        Agent.State storage _agent,
        uint64 _valueAMG,
        bool _poolSelfCloseRedemption
    )
        internal
    {
        _agent.redeemingAMG = SafeMath64.sub64(_agent.redeemingAMG, _valueAMG, "not enough redeeming");
        if (!_poolSelfCloseRedemption) {
            _agent.poolRedeemingAMG = SafeMath64.sub64(_agent.poolRedeemingAMG, _valueAMG, "not enough redeeming");
        }
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

    // We cannot burn typical class1 collateral (stablecoins), so the agent must buy them for NAT
    // at FTSO price multiplied by class1BuyForFlarePremiumBIPS and then we burn the NATs.
    function burnCollateralClass1(
        Agent.State storage _agent,
        uint256 _amountClass1Wei
    )
        internal
    {
        CollateralToken.Data storage class1Collateral = getClass1Collateral(_agent);
        CollateralToken.Data storage poolCollateral = getPoolCollateral(_agent);
        if (class1Collateral.token == poolCollateral.token) {
            // If class1 collateral is NAT, just burn directly.
            burnCollateralNAT(_agent, _amountClass1Wei);
        } else {
            AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
            // Calculate NAT amount the agent has to pay to receive the "burned" class1 tokens.
            // The price is FTSO price plus configurable premium (class1BuyForFlarePremiumBIPS).
            uint256 amountNatWei = Conversion.convert(_amountClass1Wei, class1Collateral, poolCollateral)
                .mulBips(settings.class1BuyForFlareFactorBIPS);
            // Transfer class1 collateral to the agent vault owner
            SafeERC20.safeTransfer(class1Collateral.token, _agent.ownerColdAddress, _amountClass1Wei);
            // Burn the NAT equivalent from agent's vault.
            // We could have the agent send NATs along with the external call instead, but that raises issues of
            // returning overpaid NATs, so the agent should just deposit NATs to the vault and we pay from there.
            burnCollateralNAT(_agent, amountNatWei);
        }
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
            vault.payoutNAT(payable(address(burner)), _amountNATWei);
            burner.die();
        } else {
            // burn directly to burn address
            vault.payoutNAT(settings.burnAddress, _amountNATWei);
        }
    }

    function setClass1Collateral(
        Agent.State storage _agent,
        IERC20 _token
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 tokenIndex = CollateralTokens.getIndex(IAssetManager.CollateralTokenClass.CLASS1, _token);
        CollateralToken.Data storage collateral = state.collateralTokens[tokenIndex];
        require(collateral.tokenClass == IAssetManager.CollateralTokenClass.CLASS1, "not class1 collateral token");
        // agent should never switch to a deprecated or already invalid collateral
        require(collateral.validUntil == 0, "collateral deprecated");
        // check there is enough collateral for current mintings
        Collateral.Data memory switchCollateralData = AgentCollateral.agentClass1CollateralData(_agent);
        uint256 crBIPS = AgentCollateral.collateralRatioBIPS(switchCollateralData, _agent);
        require(crBIPS >= collateral.minCollateralRatioBIPS, "not enough collateral");
        // set the new index
        _agent.class1CollateralIndex = tokenIndex.toUint16();
    }

    function vaultOwner(
        Agent.State storage _agent
    )
        internal view
        returns (address _ownerColdAddress, address _ownerHotAddress)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        _ownerColdAddress = _agent.ownerColdAddress;
        _ownerHotAddress = state.ownerColdToHot[_ownerColdAddress];
    }

    function isOwner(
        Agent.State storage _agent,
        address _address
    )
        internal view
        returns (bool)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        address ownerColdAddress = _agent.ownerColdAddress;
        return _address == ownerColdAddress || _address == state.ownerColdToHot[ownerColdAddress];
    }

    function requireWhitelisted(
        address _ownerColdAddress
    )
        internal view
    {
        IWhitelist whitelist = AssetManagerState.getSettings().agentWhitelist;
        require(address(whitelist) == address(0) || whitelist.isWhitelisted(_ownerColdAddress),
            "agent not whitelisted");
    }

    function requireWhitelistedAgentVaultOwner(
        Agent.State storage _agent
    )
        internal view
    {
        requireWhitelisted(_agent.ownerColdAddress);
    }

    function requireAgentVaultOwner(
        address _agentVault
    )
        internal view
    {
        require(isOwner(Agent.get(_agentVault), msg.sender), "only agent vault owner");
    }

    function requireAgentVaultOwner(
        Agent.State storage _agent
    )
        internal view
    {
        require(isOwner(_agent, msg.sender), "only agent vault owner");
    }

    function requireCollateralPool(
        Agent.State storage _agent
    )
        internal view
    {
        require(msg.sender == address(_agent.collateralPool), "only collateral pool");
    }

    function isCollateralToken(
        Agent.State storage _agent,
        IERC20 _token
    )
        internal view
        returns (bool)
    {
        return _token == getPoolWNat(_agent) || _token == getClass1Token(_agent);
    }

    function getClass1Token(Agent.State storage _agent)
        internal view
        returns (IERC20)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[_agent.class1CollateralIndex].token;
    }

    function getClass1Collateral(Agent.State storage _agent)
        internal view
        returns (CollateralToken.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[_agent.class1CollateralIndex];
    }

    function convertUSD5ToClass1Wei(Agent.State storage _agent, uint256 _amountUSD5)
        internal view
        returns (uint256)
    {
        return Conversion.convertFromUSD5(_amountUSD5, getClass1Collateral(_agent));
    }

    function getPoolWNat(Agent.State storage _agent)
        internal view
        returns (IWNat)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return IWNat(address(state.collateralTokens[_agent.poolCollateralIndex].token));
    }

    function getPoolCollateral(Agent.State storage _agent)
        internal view
        returns (CollateralToken.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[_agent.poolCollateralIndex];
    }

    function getCollateral(Agent.State storage _agent, Collateral.Kind _kind)
        internal view
        returns (CollateralToken.Data storage)
    {
        assert (_kind != Collateral.Kind.AGENT_POOL);   // there is no agent pool collateral token
        AssetManagerState.State storage state = AssetManagerState.get();
        if (_kind == Collateral.Kind.AGENT_CLASS1) {
            return state.collateralTokens[_agent.class1CollateralIndex];
        } else {
            return state.collateralTokens[_agent.poolCollateralIndex];
        }
    }

    function getCollateralOwner(Agent.State storage _agent, Collateral.Kind _kind)
        internal view
        returns (address)
    {
        return _kind == Collateral.Kind.POOL ? address(_agent.collateralPool): _agent.vaultAddress();
    }

    function collateralUnderwater(Agent.State storage _agent, Collateral.Kind _kind)
        internal view
        returns (bool)
    {
        if (_kind == Collateral.Kind.AGENT_CLASS1) {
            return (_agent.collateralsUnderwater & Agent.LF_CLASS1) != 0;
        } else if (_kind == Collateral.Kind.POOL) {
            return (_agent.collateralsUnderwater & Agent.LF_POOL) != 0;
        } else {
            return false;    // AGENT_POOL collateral cannot be underwater (it only affects minting)
        }
    }

    function withdrawalAnnouncement(Agent.State storage _agent, Collateral.Kind _kind)
        internal view
        returns (Agent.WithdrawalAnnouncement storage)
    {
        assert (_kind != Collateral.Kind.POOL);     // agent cannot withdraw from pool
        return _kind == Collateral.Kind.AGENT_CLASS1
            ? _agent.class1WithdrawalAnnouncement
            : _agent.poolTokenWithdrawalAnnouncement;
    }
}
