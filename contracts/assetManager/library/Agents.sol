// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../utils/lib/SafeMath64.sol";
import "../interfaces/IIAgentVault.sol";
import "./data/AssetManagerState.sol";
import "./data/Collateral.sol";
import "./AMEvents.sol";
import "./Globals.sol";
import "./Conversion.sol";
import "./CollateralTypes.sol";
import "./AgentCollateral.sol";

library Agents {
    using SafeCast for uint256;
    using SafePct for uint256;
    using Agent for Agent.State;
    using RedemptionQueue for RedemptionQueue.State;

    function setMintingVaultCollateralRatioBIPS(
        Agent.State storage _agent,
        uint256 _mintingVaultCollateralRatioBIPS
    )
        internal
    {
        CollateralTypeInt.Data storage collateral = getVaultCollateral(_agent);
        require(_mintingVaultCollateralRatioBIPS >= collateral.minCollateralRatioBIPS,
            "collateral ratio too small");
        _agent.mintingVaultCollateralRatioBIPS = _mintingVaultCollateralRatioBIPS.toUint32();
    }

    function setMintingPoolCollateralRatioBIPS(
        Agent.State storage _agent,
        uint256 _mintingPoolCollateralRatioBIPS
    )
        internal
    {
        CollateralTypeInt.Data storage collateral = getPoolCollateral(_agent);
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
        require(_feeBIPS < SafePct.MAX_BIPS, "fee too high");
        _agent.feeBIPS = _feeBIPS.toUint16();
    }

    function setPoolFeeShareBIPS(
        Agent.State storage _agent,
        uint256 _poolFeeShareBIPS
    )
        internal
    {
        require(_poolFeeShareBIPS < SafePct.MAX_BIPS, "value too high");
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
        CollateralTypeInt.Data storage collateral = getPoolCollateral(_agent);
        uint256 minCR = Math.max(_agent.mintingPoolCollateralRatioBIPS, collateral.minCollateralRatioBIPS);
        require(_poolExitCollateralRatioBIPS >= minCR, "value too low");
        uint256 currentExitCR = _agent.collateralPool.exitCollateralRatioBIPS();
        require(_poolExitCollateralRatioBIPS <= currentExitCR * 3 / 2, "increase too big");
        _agent.collateralPool.setExitCollateralRatioBIPS(_poolExitCollateralRatioBIPS);
    }

    function setPoolTopupCollateralRatioBIPS(
        Agent.State storage _agent,
        uint256 _poolTopupCollateralRatioBIPS
    )
        internal
    {
        CollateralTypeInt.Data storage collateral = getPoolCollateral(_agent);
        require(_poolTopupCollateralRatioBIPS >= collateral.minCollateralRatioBIPS, "value too low");
        _agent.collateralPool.setTopupCollateralRatioBIPS(_poolTopupCollateralRatioBIPS);
    }

    function setPoolTopupTokenPriceFactorBIPS(
        Agent.State storage _agent,
        uint256 _poolTopupTokenPriceFactorBIPS
    )
        internal
    {
        _agent.collateralPool.setTopupTokenPriceFactorBIPS(_poolTopupTokenPriceFactorBIPS);
    }

    function setIdentityVerificationType(
        Agent.State storage _agent,
        uint256 _identityVerificationType
    )
        internal
    {
        _agent.identityVerificationType = _identityVerificationType.toUint32();
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

    function createRedemptionTicket(
        Agent.State storage _agent,
        uint64 _ticketValueAMG
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        address vaultAddress = _agent.vaultAddress();
        uint64 ticketId = state.redemptionQueue.createRedemptionTicket(vaultAddress, _ticketValueAMG);
        uint256 ticketValueUBA = Conversion.convertAmgToUBA(_ticketValueAMG);
        emit AMEvents.RedemptionTicketCreated(vaultAddress, ticketId, ticketValueUBA);
    }

    function changeDust(
        Agent.State storage _agent,
        uint64 _newDustAMG
    )
        internal
    {
        if (_agent.dustAMG == _newDustAMG) return;
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
        changeDust(_agent, _agent.dustAMG + _dustIncreaseAMG);
    }

    function decreaseDust(
        Agent.State storage _agent,
        uint64 _dustDecreaseAMG
    )
        internal
    {
        uint64 newDustAMG = SafeMath64.sub64(_agent.dustAMG, _dustDecreaseAMG, "not enough dust");
        changeDust(_agent, newDustAMG);
    }

    function payoutFromVault(
        Agent.State storage _agent,
        address _receiver,
        uint256 _amountWei
    )
        internal
        returns (uint256 _amountPaid)
    {
        CollateralTypeInt.Data storage collateral = getVaultCollateral(_agent);
        // don't want the calling method to fail due to too small balance for payout
        IIAgentVault vault = IIAgentVault(_agent.vaultAddress());
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

    // We cannot burn typical vault collateral (stablecoins), so the agent must buy them for NAT
    // at FTSO price multiplied by vaultCollateralBuyForFlareFactorBIPS and then we burn the NATs.
    function burnVaultCollateral(
        Agent.State storage _agent,
        uint256 _amountVaultCollateralWei
    )
        internal
    {
        CollateralTypeInt.Data storage vaultCollateral = getVaultCollateral(_agent);
        CollateralTypeInt.Data storage poolCollateral = getPoolCollateral(_agent);
        if (vaultCollateral.token == poolCollateral.token) {
            // If vault collateral is NAT, just burn directly.
            burnVaultNATCollateral(_agent, _amountVaultCollateralWei);
        } else {
            AssetManagerSettings.Data storage settings = Globals.getSettings();
            IIAgentVault vault = IIAgentVault(_agent.vaultAddress());
            // Calculate NAT amount the agent has to pay to receive the "burned" vault collateral tokens.
            // The price is FTSO price plus configurable premium (vaultCollateralBuyForFlareFactorBIPS).
            uint256 amountNatWei = Conversion.convert(_amountVaultCollateralWei, vaultCollateral, poolCollateral)
                .mulBips(settings.vaultCollateralBuyForFlareFactorBIPS);
            // Transfer vault collateral to the agent vault owner
            vault.payout(vaultCollateral.token, _agent.ownerManagementAddress, _amountVaultCollateralWei);
            // Burn the NAT equivalent (must be provided with the call).
            require(msg.value >= amountNatWei, "not enough funds provided");
            burnDirectNAT(amountNatWei);
            // If there is some overpaid NAT, just send it to the agent's vault.
            if (msg.value > amountNatWei) {
                vault.depositNat{ value: msg.value - amountNatWei }(Globals.getWNat());
            }
        }
    }

    function burnVaultNATCollateral(
        Agent.State storage _agent,
        uint256 _amountNATWei
    )
        internal
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        IIAgentVault vault = IIAgentVault(_agent.vaultAddress());
        vault.payoutNAT(Globals.getWNat(), settings.burnAddress, _amountNATWei);
    }

    function burnDirectNAT(
        uint256 _amountNATWei
    )
        internal
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        settings.burnAddress.transfer(_amountNATWei);
    }

    function setVaultCollateral(
        Agent.State storage _agent,
        IERC20 _token
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 tokenIndex = CollateralTypes.getIndex(CollateralType.Class.VAULT, _token);
        CollateralTypeInt.Data storage collateral = state.collateralTokens[tokenIndex];
        assert(collateral.collateralClass == CollateralType.Class.VAULT);
        // agent should never switch to a deprecated or already invalid collateral
        require(collateral.validUntil == 0, "collateral deprecated");
        // set the new index
        _agent.vaultCollateralIndex = tokenIndex.toUint16();
        // check there is enough collateral for current mintings
        Collateral.Data memory switchCollateralData = AgentCollateral.agentVaultCollateralData(_agent);
        uint256 crBIPS = AgentCollateral.collateralRatioBIPS(switchCollateralData, _agent);
        require(crBIPS >= collateral.minCollateralRatioBIPS, "not enough collateral");
    }

    function isOwner(
        Agent.State storage _agent,
        address _address
    )
        internal view
        returns (bool)
    {
        address ownerManagementAddress = _agent.ownerManagementAddress;
        return _address == ownerManagementAddress ||
            _address == Globals.getAgentOwnerRegistry().getWorkAddress(ownerManagementAddress);
    }

    function requireWhitelisted(
        address _ownerManagementAddress
    )
        internal view
    {
        require(Globals.getAgentOwnerRegistry().isWhitelisted(_ownerManagementAddress),
            "agent not whitelisted");
    }

    function requireWhitelistedAgentVaultOwner(
        Agent.State storage _agent
    )
        internal view
    {
        requireWhitelisted(_agent.ownerManagementAddress);
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
        return _token == getPoolWNat(_agent) || _token == getVaultCollateralToken(_agent);
    }

    function getVaultCollateralToken(Agent.State storage _agent)
        internal view
        returns (IERC20)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[_agent.vaultCollateralIndex].token;
    }

    function getVaultCollateral(Agent.State storage _agent)
        internal view
        returns (CollateralTypeInt.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[_agent.vaultCollateralIndex];
    }

    function convertUSD5ToVaultCollateralWei(Agent.State storage _agent, uint256 _amountUSD5)
        internal view
        returns (uint256)
    {
        return Conversion.convertFromUSD5(_amountUSD5, getVaultCollateral(_agent));
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
        returns (CollateralTypeInt.Data storage)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[_agent.poolCollateralIndex];
    }

    function getCollateral(Agent.State storage _agent, Collateral.Kind _kind)
        internal view
        returns (CollateralTypeInt.Data storage)
    {
        assert (_kind != Collateral.Kind.AGENT_POOL);   // there is no agent pool collateral token
        AssetManagerState.State storage state = AssetManagerState.get();
        if (_kind == Collateral.Kind.VAULT) {
            return state.collateralTokens[_agent.vaultCollateralIndex];
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
        if (_kind == Collateral.Kind.VAULT) {
            return (_agent.collateralsUnderwater & Agent.LF_VAULT) != 0;
        } else {
            // AGENT_POOL collateral cannot be underwater (it only affects minting),
            // so this function will only be used for VAULT and POOL
            assert(_kind == Collateral.Kind.POOL);
            return (_agent.collateralsUnderwater & Agent.LF_POOL) != 0;
        }
    }

    function withdrawalAnnouncement(Agent.State storage _agent, Collateral.Kind _kind)
        internal view
        returns (Agent.WithdrawalAnnouncement storage)
    {
        assert (_kind != Collateral.Kind.POOL);     // agent cannot withdraw from pool
        return _kind == Collateral.Kind.VAULT
            ? _agent.vaultCollateralWithdrawalAnnouncement
            : _agent.poolTokenWithdrawalAnnouncement;
    }

    function totalBackedAMG(Agent.State storage _agent)
        internal view
        returns (uint64)
    {
        // this must always hold, so assert it is true, otherwise the following line
        // would need `max(redeemingAMG, poolRedeemingAMG)`
        assert(_agent.poolRedeemingAMG <= _agent.redeemingAMG);
        return _agent.mintedAMG + _agent.reservedAMG + _agent.redeemingAMG;
    }
}
