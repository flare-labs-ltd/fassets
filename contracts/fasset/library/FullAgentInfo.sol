// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../userInterfaces/data/AgentInfo.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./Conversion.sol";
import "./Agents.sol";
import "./AgentCollateral.sol";
import "./Liquidation.sol";
import "./UnderlyingBalance.sol";

library FullAgentInfo {
    using SafeMath for uint256;
    using SafeCast for uint256;
    using MathUtils for uint256;
    using SafePct for *;
    using AgentCollateral for Collateral.CombinedData;
    using AgentCollateral for Collateral.Data;
    using Agents for Agent.State;

    function getAgentInfo(
        address _agentVault
    )
        external view
        returns (AgentInfo.Info memory _info)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        Collateral.CombinedData memory collateralData = AgentCollateral.combinedData(agent);
        CollateralTypeInt.Data storage collateral = agent.getClass1Collateral();
        CollateralTypeInt.Data storage poolCollateral = agent.getPoolCollateral();
        Liquidation.CRData memory cr = Liquidation.getCollateralRatiosBIPS(agent);
        _info.status = _getAgentStatusInfo(agent);
        (_info.ownerColdWalletAddress, _info.ownerHotWalletAddress) = Agents.vaultOwner(agent);
        _info.collateralPool = address(agent.collateralPool);
        _info.underlyingAddressString = agent.underlyingAddressString;
        _info.publiclyAvailable = agent.availableAgentsPos != 0;
        _info.class1CollateralToken = collateral.token;
        _info.feeBIPS = agent.feeBIPS;
        _info.poolFeeShareBIPS = agent.poolFeeShareBIPS;
        _info.mintingClass1CollateralRatioBIPS =
            Math.max(agent.mintingClass1CollateralRatioBIPS, collateral.minCollateralRatioBIPS);
        _info.mintingPoolCollateralRatioBIPS =
            Math.max(agent.mintingPoolCollateralRatioBIPS, poolCollateral.minCollateralRatioBIPS);
        _info.freeCollateralLots = collateralData.freeCollateralLots(agent);
        _info.totalClass1CollateralWei = collateralData.agentCollateral.fullCollateral;
        _info.freeClass1CollateralWei = collateralData.agentCollateral.freeCollateralWei(agent);
        _info.class1CollateralRatioBIPS = cr.class1CR;
        _info.totalPoolCollateralNATWei = collateralData.poolCollateral.fullCollateral;
        _info.freePoolCollateralNATWei = collateralData.poolCollateral.freeCollateralWei(agent);
        _info.poolCollateralRatioBIPS = cr.poolCR;
        _info.totalAgentPoolTokensWei = collateralData.agentPoolTokens.fullCollateral;
        _info.freeAgentPoolTokensWei = collateralData.agentPoolTokens.freeCollateralWei(agent);
        _info.announcedClass1WithdrawalWei =
            agent.withdrawalAnnouncement(Collateral.Kind.AGENT_CLASS1).amountWei;
        _info.announcedPoolTokensWithdrawalWei =
            agent.withdrawalAnnouncement(Collateral.Kind.AGENT_POOL).amountWei;
        _info.mintedUBA = Conversion.convertAmgToUBA(agent.mintedAMG);
        _info.reservedUBA = Conversion.convertAmgToUBA(agent.reservedAMG);
        _info.redeemingUBA = Conversion.convertAmgToUBA(agent.redeemingAMG);
        _info.poolRedeemingUBA = Conversion.convertAmgToUBA(agent.poolRedeemingAMG);
        _info.dustUBA = Conversion.convertAmgToUBA(agent.dustAMG);
        _info.ccbStartTimestamp = _getCCBStartTime(agent);
        _info.liquidationStartTimestamp = _getLiquidationStartTime(agent);
        _info.underlyingBalanceUBA = agent.underlyingBalanceUBA;
        _info.requiredUnderlyingBalanceUBA = UnderlyingBalance.requiredUnderlyingUBA(agent);
        _info.freeUnderlyingBalanceUBA =
            _info.underlyingBalanceUBA - _info.requiredUnderlyingBalanceUBA.toInt256();
        _info.announcedUnderlyingWithdrawalId = agent.announcedUnderlyingWithdrawalId;
        _info.buyFAssetByAgentFactorBIPS = agent.buyFAssetByAgentFactorBIPS;
        _info.poolExitCollateralRatioBIPS = agent.collateralPool.exitCollateralRatioBIPS();
        _info.poolTopupCollateralRatioBIPS = agent.collateralPool.topupCollateralRatioBIPS();
        _info.poolTopupTokenPriceFactorBIPS = agent.collateralPool.topupTokenPriceFactorBIPS();
    }

    function _getAgentStatusInfo(
        Agent.State storage _agent
    )
        private view
        returns (AgentInfo.Status)
    {
        Agent.Status status = _agent.status;
        if (status == Agent.Status.NORMAL) {
            return AgentInfo.Status.NORMAL;
        } else if (status == Agent.Status.LIQUIDATION) {
            Agent.LiquidationPhase phase = Liquidation.currentLiquidationPhase(_agent);
            return phase == Agent.LiquidationPhase.CCB ? AgentInfo.Status.CCB : AgentInfo.Status.LIQUIDATION;
        } else if (status == Agent.Status.FULL_LIQUIDATION) {
            return AgentInfo.Status.FULL_LIQUIDATION;
        } else {
            assert (status == Agent.Status.DESTROYING);
            return AgentInfo.Status.DESTROYING;
        }
    }

    function _getCCBStartTime(
        Agent.State storage _agent
    )
        private view
        returns (uint256)
    {
        if (_agent.status != Agent.Status.LIQUIDATION) return 0;
        return _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB ? _agent.liquidationStartedAt : 0;
    }

    function _getLiquidationStartTime(
        Agent.State storage _agent
    )
        private view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        if (_agent.status == Agent.Status.LIQUIDATION) {
            return _agent.initialLiquidationPhase == Agent.LiquidationPhase.CCB
                ? _agent.liquidationStartedAt + settings.ccbTimeSeconds
                : _agent.liquidationStartedAt;
        } else if (_agent.status == Agent.Status.FULL_LIQUIDATION) {
            return _agent.liquidationStartedAt;
        } else {
            return 0;
        }
    }
}
