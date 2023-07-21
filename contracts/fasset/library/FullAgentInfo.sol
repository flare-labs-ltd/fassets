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
        CollateralTypeInt.Data storage collateral = agent.getVaultCollateral();
        CollateralTypeInt.Data storage poolCollateral = agent.getPoolCollateral();
        Liquidation.CRData memory cr = Liquidation.getCollateralRatiosBIPS(agent);
        _info.status = _getAgentStatusInfo(agent);
        (_info.ownerColdWalletAddress, _info.ownerHotWalletAddress) = Agents.vaultOwner(agent);
        _info.contingencyPool = address(agent.contingencyPool);
        _info.underlyingAddressString = agent.underlyingAddressString;
        _info.publiclyAvailable = agent.availableAgentsPos != 0;
        _info.vaultCollateralToken = collateral.token;
        _info.feeBIPS = agent.feeBIPS;
        _info.poolFeeShareBIPS = agent.poolFeeShareBIPS;
        _info.mintingVaultCollateralRatioBIPS =
            Math.max(agent.mintingVaultCollateralRatioBIPS, collateral.minCollateralRatioBIPS);
        _info.mintingPoolCollateralRatioBIPS =
            Math.max(agent.mintingPoolCollateralRatioBIPS, poolCollateral.minCollateralRatioBIPS);
        _info.freeCollateralLots = collateralData.freeCollateralLots(agent);
        _info.totalVaultCollateralWei = collateralData.agentCollateral.fullCollateral;
        _info.freeVaultCollateralWei = collateralData.agentCollateral.freeCollateralWei(agent);
        _info.vaultCollateralRatioBIPS = cr.vaultCR;
        _info.totalPoolCollateralNATWei = collateralData.poolCollateral.fullCollateral;
        _info.freePoolCollateralNATWei = collateralData.poolCollateral.freeCollateralWei(agent);
        _info.poolCollateralRatioBIPS = cr.poolCR;
        _info.totalAgentPoolTokensWei = collateralData.agentPoolTokens.fullCollateral;
        _info.freeAgentPoolTokensWei = collateralData.agentPoolTokens.freeCollateralWei(agent);
        _info.announcedVaultCollateralWithdrawalWei =
            agent.withdrawalAnnouncement(Collateral.Kind.VAULT).amountWei;
        _info.announcedPoolTokensWithdrawalWei =
            agent.withdrawalAnnouncement(Collateral.Kind.AGENT_POOL).amountWei;
        _info.mintedUBA = Conversion.convertAmgToUBA(agent.mintedAMG);
        _info.reservedUBA = Conversion.convertAmgToUBA(agent.reservedAMG);
        _info.redeemingUBA = Conversion.convertAmgToUBA(agent.redeemingAMG);
        _info.poolRedeemingUBA = Conversion.convertAmgToUBA(agent.poolRedeemingAMG);
        _info.dustUBA = Conversion.convertAmgToUBA(agent.dustAMG);
        _info.ccbStartTimestamp = Liquidation.getCCBStartTimestamp(agent);
        _info.liquidationStartTimestamp = Liquidation.getLiquidationStartTimestamp(agent);
        _info.underlyingBalanceUBA = agent.underlyingBalanceUBA;
        _info.requiredUnderlyingBalanceUBA = UnderlyingBalance.requiredUnderlyingUBA(agent);
        _info.freeUnderlyingBalanceUBA =
            _info.underlyingBalanceUBA - _info.requiredUnderlyingBalanceUBA.toInt256();
        _info.announcedUnderlyingWithdrawalId = agent.announcedUnderlyingWithdrawalId;
        _info.buyFAssetByAgentFactorBIPS = agent.buyFAssetByAgentFactorBIPS;
        _info.poolExitCollateralRatioBIPS = agent.contingencyPool.exitCollateralRatioBIPS();
        _info.poolTopupCollateralRatioBIPS = agent.contingencyPool.topupCollateralRatioBIPS();
        _info.poolTopupTokenPriceFactorBIPS = agent.contingencyPool.topupTokenPriceFactorBIPS();
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
}
