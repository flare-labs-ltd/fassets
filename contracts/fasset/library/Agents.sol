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

library Agents {
    using SafeCast for uint256;
    using SafePct for uint256;
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
            (uint256 priceMul, uint256 priceDiv) =
                Conversion.currentWeiPriceRatio(class1Collateral, poolCollateral);
            uint256 amountNatWei = _amountClass1Wei.mulDiv(priceMul, priceDiv)
                .mulBips(settings.class1BuyForFlareFactorBIPS);
            // Transfer class1 collateral to the agent vault owner
            SafeERC20.safeTransfer(class1Collateral.token, vaultOwner(_agent), _amountClass1Wei);
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
        string memory _tokenIdentifier
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        uint256 tokenIndex = CollateralTokens.getIndex(_tokenIdentifier);
        CollateralToken.Data storage token = state.collateralTokens[tokenIndex];
        require(token.tokenClass == IAssetManager.CollateralTokenClass.CLASS1, "not class1 collateral token");
        // agent should never switch to a deprecated or already invalid token
        require(token.validUntil == 0, "token deprecated");
        // TODO: check there is enough collateral for current mintings
        _agent.class1CollateralToken = tokenIndex.toUint16();
        // TODO: timelock, otherwise there can be withdrawal without announcement
        // (by switching, withdrawing and switching back)
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

    function requireOnlyCollateralPool(
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
        return _token == getPoolCollateralToken(_agent) || _token == getClass1Token(_agent);
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

    function getPoolCollateralToken(Agent.State storage _agent)
        internal view
        returns (IERC20)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.collateralTokens[_agent.poolCollateralToken].token;
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
