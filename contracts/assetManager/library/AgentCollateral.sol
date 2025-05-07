// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafePct.sol";
import "../../utils/lib/MathUtils.sol";
import "./data/AssetManagerState.sol";
import "./data/Collateral.sol";
import "./Conversion.sol";
import "./Agents.sol";


library AgentCollateral {
    using SafePct for uint256;
    using Agent for Agent.State;
    using Agents for Agent.State;

    function combinedData(
        Agent.State storage _agent
    )
        internal view
        returns (Collateral.CombinedData memory)
    {
        Collateral.Data memory poolCollateral = poolCollateralData(_agent);
        return Collateral.CombinedData({
            agentCollateral: agentVaultCollateralData(_agent),
            poolCollateral: poolCollateral,
            agentPoolTokens: agentsPoolTokensCollateralData(_agent, poolCollateral)
        });
    }

    function singleCollateralData(
        Agent.State storage _agent,
        Collateral.Kind _kind
    )
        internal view
        returns (Collateral.Data memory)
    {
        if (_kind == Collateral.Kind.VAULT) {
            return agentVaultCollateralData(_agent);
        } else if (_kind == Collateral.Kind.POOL) {
            return poolCollateralData(_agent);
        } else {
            return agentsPoolTokensCollateralData(_agent, poolCollateralData(_agent));
        }
    }

    function agentVaultCollateralData(
        Agent.State storage _agent
    )
        internal view
        returns (Collateral.Data memory)
    {
        CollateralTypeInt.Data storage collateral = _agent.getVaultCollateral();
        return Collateral.Data({
            kind: Collateral.Kind.VAULT,
            fullCollateral: collateral.token.balanceOf(_agent.vaultAddress()),
            amgToTokenWeiPrice: Conversion.currentAmgPriceInTokenWei(collateral)
        });
    }

    function poolCollateralData(
        Agent.State storage _agent
    )
        internal view
        returns (Collateral.Data memory)
    {
        CollateralTypeInt.Data storage collateral = _agent.getPoolCollateral();
        return Collateral.Data({
            kind: Collateral.Kind.POOL,
            fullCollateral: _agent.collateralPool.totalCollateral(),
            amgToTokenWeiPrice: Conversion.currentAmgPriceInTokenWei(collateral)
        });
    }

    function agentsPoolTokensCollateralData(
        Agent.State storage _agent,
        Collateral.Data memory _poolCollateral
    )
        internal view
        returns (Collateral.Data memory)
    {
        IERC20 poolToken = _agent.collateralPool.poolToken();
        uint256 agentPoolTokens = poolToken.balanceOf(_agent.vaultAddress());
        uint256 totalPoolTokens = poolToken.totalSupply();
        uint256 amgToPoolTokenWeiPrice = _poolCollateral.fullCollateral != 0
            ? _poolCollateral.amgToTokenWeiPrice.mulDiv(totalPoolTokens, _poolCollateral.fullCollateral)
            : _poolCollateral.amgToTokenWeiPrice;   // price for empty pool is 1 token/NAT
        return Collateral.Data({
            kind: Collateral.Kind.AGENT_POOL,
            fullCollateral: agentPoolTokens,
            amgToTokenWeiPrice: amgToPoolTokenWeiPrice
        });
    }

    // The max number of lots the agent can mint
    function freeCollateralLots(
        Collateral.CombinedData memory _data,
        Agent.State storage _agent
    )
        internal view
        returns (uint256 _lots)
    {
        return freeCollateralLotsOptionalFee(_data, _agent, true);
    }

    function freeCollateralLotsOptionalFee(
        Collateral.CombinedData memory _data,
        Agent.State storage _agent,
        bool _chargePoolFee
    )
        internal view
        returns (uint256 _lots)
    {
        uint256 agentLots = freeSingleCollateralLots(_data.agentCollateral, _agent, _chargePoolFee);
        uint256 poolLots = freeSingleCollateralLots(_data.poolCollateral, _agent, _chargePoolFee);
        uint256 agentPoolTokenLots = freeSingleCollateralLots(_data.agentPoolTokens, _agent, _chargePoolFee);
        return Math.min(agentLots, Math.min(poolLots, agentPoolTokenLots));
    }

    function freeSingleCollateralLots(
        Collateral.Data memory _data,
        Agent.State storage _agent,
        bool _chargePoolFee
    )
        internal view
        returns (uint256)
    {
        uint256 collateralWei = freeCollateralWei(_data, _agent);
        uint256 lotWei = mintingLotCollateralWei(_data, _agent, _chargePoolFee);
        // lotWei=0 is possible only for agent's pool token collateral if pool balance in NAT is 0
        // so then we can safely return 0 here, since minting is impossible
        return lotWei != 0 ? collateralWei / lotWei : 0;
    }

    function freeCollateralWei(
        Collateral.Data memory _data,
        Agent.State storage _agent
    )
        internal view
        returns (uint256)
    {
        uint256 lockedCollateral = lockedCollateralWei(_data, _agent);
        return MathUtils.subOrZero(_data.fullCollateral, lockedCollateral);
    }

    // Amount of collateral NOT available for new minting or withdrawal.
    function lockedCollateralWei(
        Collateral.Data memory _data,
        Agent.State storage _agent
    )
        internal view
        returns (uint256)
    {
        (uint256 mintingMinCollateralRatioBIPS, uint256 systemMinCollateralRatioBIPS) =
            mintingMinCollateralRatio(_agent, _data.kind);
        uint256 backedAMG = uint256(_agent.reservedAMG) + uint256(_agent.mintedAMG);
        uint256 mintingCollateral = Conversion.convertAmgToTokenWei(backedAMG, _data.amgToTokenWeiPrice)
            .mulBips(mintingMinCollateralRatioBIPS);
        uint64 redeemingAMG = _data.kind == Collateral.Kind.POOL ? _agent.poolRedeemingAMG : _agent.redeemingAMG;
        uint256 redeemingCollateral = Conversion.convertAmgToTokenWei(redeemingAMG, _data.amgToTokenWeiPrice)
            .mulBips(systemMinCollateralRatioBIPS);
        uint256 announcedWithdrawal =
            _data.kind != Collateral.Kind.POOL ? _agent.withdrawalAnnouncement(_data.kind).amountWei : 0;
        return mintingCollateral + redeemingCollateral + announcedWithdrawal;
    }

    function mintingLotCollateralWei(
        Collateral.Data memory _data,
        Agent.State storage _agent,
        bool _chargePoolFee
    )
        internal view
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        return collateralRequiredToMintAmount(_data, _agent, settings.lotSizeAMG, _chargePoolFee);
    }

    function collateralRequiredToMintAmount(
        Collateral.Data memory _data,
        Agent.State storage _agent,
        uint256 _amountAMG,
        bool _chargePoolFee
    )
        internal view
        returns (uint256)
    {
        uint256 amountPoolFeeAMG =
            _chargePoolFee ? _amountAMG.mulBips(_agent.feeBIPS).mulBips(_agent.poolFeeShareBIPS) : 0;
        uint256 totalMintAmountAMG = _amountAMG + amountPoolFeeAMG;
        uint256 totalMintAmountWei = Conversion.convertAmgToTokenWei(totalMintAmountAMG, _data.amgToTokenWeiPrice);
        (uint256 mintingCollateralRatio,) = mintingMinCollateralRatio(_agent, _data.kind);
        return totalMintAmountWei.mulBips(mintingCollateralRatio);
    }

    function mintingMinCollateralRatio(
        Agent.State storage _agent,
        Collateral.Kind _kind
    )
        internal view
        returns (uint256 _mintingMinCollateralRatioBIPS, uint256 _systemMinCollateralRatioBIPS)
    {
        if (_kind == Collateral.Kind.AGENT_POOL) {
            uint256 mintingPoolHoldingsRequiredBIPS = Globals.getSettings().mintingPoolHoldingsRequiredBIPS;
            _systemMinCollateralRatioBIPS = mintingPoolHoldingsRequiredBIPS;
            _mintingMinCollateralRatioBIPS = mintingPoolHoldingsRequiredBIPS;
        } else if (_kind == Collateral.Kind.POOL) {
            _systemMinCollateralRatioBIPS = _agent.getPoolCollateral().minCollateralRatioBIPS;
            _mintingMinCollateralRatioBIPS =
                Math.max(_agent.mintingPoolCollateralRatioBIPS, _systemMinCollateralRatioBIPS);
        } else {
            _systemMinCollateralRatioBIPS = _agent.getVaultCollateral().minCollateralRatioBIPS;
            // agent's minCollateralRatioBIPS must be greater than minCollateralRatioBIPS when set, but
            // minCollateralRatioBIPS can change later so we always use the max of both
            _mintingMinCollateralRatioBIPS =
                Math.max(_agent.mintingVaultCollateralRatioBIPS, _systemMinCollateralRatioBIPS);
        }
    }

    // Used for redemption default payment - calculate all types of collateral at the same rate, so that
    // future redemptions don't get less than this one (unless the price changes).
    // Ignores collateral announced for withdrawal (redemption has priority over withdrawal).
    function maxRedemptionCollateral(
        Collateral.Data memory _data,
        Agent.State storage _agent,
        uint256 _valueAMG
    )
        internal view
        returns (uint256)
    {
        if (_valueAMG == 0) return 0;
        // Assume: collateral kind is VAULT or redemption is NOT a pool self close redemption.
        // For pool self close redemptions, pool collateral is never paid, so this method is not used.
        uint256 redeemingAMG = _data.kind == Collateral.Kind.POOL ? _agent.poolRedeemingAMG : _agent.redeemingAMG;
        assert(_valueAMG <= redeemingAMG);
        uint256 totalAMG = uint256(_agent.mintedAMG) + uint256(_agent.reservedAMG) + uint256(redeemingAMG);
        return _data.fullCollateral.mulDiv(_valueAMG, totalAMG); // totalAMG > 0 (guarded by assert)
    }

    // Agent's collateral ratio for single collateral type (BIPS) - used in liquidation.
    // Ignores collateral announced for withdrawal (withdrawals are forbidden during liquidation).
    function collateralRatioBIPS(
        Collateral.Data memory _data,
        Agent.State storage _agent
    )
        internal view
        returns (uint256)
    {
        uint256 redeemingAMG = _data.kind == Collateral.Kind.POOL ? _agent.poolRedeemingAMG : _agent.redeemingAMG;
        uint256 totalAMG = uint256(_agent.mintedAMG) + uint256(_agent.reservedAMG) + uint256(redeemingAMG);
        uint256 backingTokenWei = Conversion.convertAmgToTokenWei(totalAMG, _data.amgToTokenWeiPrice);
        if (backingTokenWei == 0) return 1e10;    // nothing minted - ~infinite collateral ratio (but avoid overflows)
        return _data.fullCollateral.mulDiv(SafePct.MAX_BIPS, backingTokenWei);
    }
}
