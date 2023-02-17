// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interface/IAssetManager.sol";
import "../../utils/implementation/NativeTokenBurner.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";
import "./Liquidation.sol";

library Agents {
    using SafeBips for uint256;
    using SafePct for uint256;
    using SafeCast for uint256;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    using RedemptionQueue for RedemptionQueue.State;
    using AgentCollateral for Collateral.Data;
    using AssetManagerState for AssetManagerState.State;
    
    
    function claimAddressWithEOAProof(
        IAttestationClient.Payment calldata _payment
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        TransactionAttestation.verifyPaymentSuccess(_payment);
        state.underlyingAddressOwnership.claimWithProof(_payment, state.paymentConfirmations, msg.sender);
        // Make sure that current underlying block is at least as high as the EOA proof block.
        // This ensures that any transaction done at or before EOA check cannot be used as payment proof for minting.
        // It prevents the attack where an agent guesses the minting id, pays to the underlying address,
        // then removes all in EOA proof transaction (or a transaction before EOA proof) and finally uses the
        // proof of transaction for minting.
        // Since we have a proof of the block N, current block is at least N+1.
        uint64 leastCurrentBlock = _payment.blockNumber + 1;
        if (leastCurrentBlock > state.currentUnderlyingBlock) {
            state.currentUnderlyingBlock = leastCurrentBlock;
        }
    }
    
    function createAgent(
        Agent.Type _agentType,
        IAssetManager _assetManager,
        string memory _underlyingAddressString,
        uint256 _collateralTokenClass1
    ) 
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        IAgentVaultFactory agentVaultFactory = state.settings.agentVaultFactory;
        IAgentVault agentVault = agentVaultFactory.create(_assetManager, payable(msg.sender));
        Agent.State storage agent = state.agents[address(agentVault)];
        assert(agent.agentType == Agent.Type.NONE);
        assert(_agentType == Agent.Type.AGENT_100); // AGENT_0 not supported yet
        require(bytes(_underlyingAddressString).length != 0, "empty underlying address");
        agent.agentType = _agentType;
        agent.status = Agent.Status.NORMAL;
        // set collateral token type
        require(_collateralTokenClass1 >= 1 && _collateralTokenClass1 < state.collateralTokens.length,
            "invalid collateral token index");
        CollateralToken.Data storage collateral = state.collateralTokens[_collateralTokenClass1];
        require(collateral.tokenClass == CollateralToken.TokenClass.CLASS1,
            "invalid collateral token class");
        agent.collateralTokenC1 = _collateralTokenClass1.toUint16();
        // initially, agentMinCollateralRatioBIPS is the same as global min collateral ratio
        // this setting is ok for self-minting, but not for public minting since it quickly leads to liquidation
        // it can be changed with setAgentMinCollateralRatioBIPS or when agent becomes available
        agent.agentMinCollateralRatioBIPS = collateral.minCollateralRatioBIPS;
        // claim the address to make sure no other agent is using it
        // for chains where this is required, also checks that address was proved to be EOA
        bytes32 underlyingAddressHash = keccak256(bytes(_underlyingAddressString));
        state.underlyingAddressOwnership.claim(msg.sender, underlyingAddressHash, 
            state.settings.requireEOAAddressProof);
        agent.underlyingAddressString = _underlyingAddressString;
        agent.underlyingAddressHash = underlyingAddressHash;
        uint64 eoaProofBlock = state.underlyingAddressOwnership.underlyingBlockOfEOAProof(underlyingAddressHash);
        agent.underlyingBlockAtCreation = SafeMath64.max64(state.currentUnderlyingBlock, eoaProofBlock + 1);
        emit AMEvents.AgentCreated(msg.sender, uint8(_agentType), address(agentVault), _underlyingAddressString);
    }
    
    function announceDestroy(
        address _agentVault
    )
        external
    {
        Agent.State storage agent = getAgent(_agentVault);
        requireAgentVaultOwner(_agentVault);
        // all minting must stop and all minted assets must have been cleared
        require(agent.availableAgentsPos == 0, "agent still available");
        require(agent.mintedAMG == 0 && agent.reservedAMG == 0 && agent.redeemingAMG == 0, "agent still active");
        // if not destroying yet, start timing
        if (agent.status != Agent.Status.DESTROYING) {
            agent.status = Agent.Status.DESTROYING;
            agent.withdrawalAnnouncedAt = block.timestamp.toUint64();
            emit AMEvents.AgentDestroyAnnounced(_agentVault, block.timestamp);
        }
    }

    function destroyAgent(
        address _agentVault
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = getAgent(_agentVault);
        requireAgentVaultOwner(_agentVault);
        // destroy must have been announced enough time before
        require(agent.status == Agent.Status.DESTROYING, "destroy not announced");
        require(block.timestamp > agent.withdrawalAnnouncedAt + state.settings.withdrawalWaitMinSeconds,
            "destroy: not allowed yet");
        // cannot have any minting when in destroying status
        assert(agent.mintedAMG == 0 && agent.reservedAMG == 0 && agent.redeemingAMG == 0);
        // delete agent data
        delete state.agents[_agentVault];
        // destroy agent vault
        IAgentVault(_agentVault).destroy();
        // notify
        emit AMEvents.AgentDestroyed(_agentVault);
    }
    
    function buybackAgentCollateral(
        address _agentVault
    )
        external
    {
        // check that fAsset is terminated is in AssetManager
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = getAgent(_agentVault);
        requireAgentVaultOwner(_agentVault);
        // Types of various collateral types:
        // - reservedAMG should be 0, since asset manager had to be paused for a month, so all collateral 
        //   reservation requests must have been minted or defaulted by now.
        //   However, it may be nonzero due to some forgotten payment proof, so we burn and clear it.
        // - redeemingAMG corresponds to redemptions where f-assets were already burned, so the redemption can
        //   finish normally even if f-asset is now terminated
        //   If there are stuck redemptions due to lack of proof, agent should use finishRedemptionWithoutPayment.
        // - mintedAMG must be burned and cleared
        uint64 mintingAMG = agent.reservedAMG + agent.mintedAMG;
        CollateralToken.Data storage collateral = state.getClass1Collateral(agent);
        uint256 amgToTokenWeiPrice = Conversion.currentAmgPriceInTokenWei(collateral);
        uint256 buybackCollateral = Conversion.convertAmgToTokenWei(mintingAMG, amgToTokenWeiPrice)
            .mulBips(state.settings.buybackCollateralFactorBIPS);
        burnCollateral(_agentVault, buybackCollateral);
        agent.mintedAMG = 0;
        state.totalReservedCollateralAMG -= agent.reservedAMG;
        agent.reservedAMG = 0;
    }
    
    function setAgentMinCollateralRatioBIPS(
        address _agentVault,
        uint256 _agentMinCollateralRatioBIPS
    )
        internal
    {
        // TODO: add min pool collateral
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agents.getAgent(_agentVault);
        requireAgentVaultOwner(_agentVault);
        CollateralToken.Data storage collateral = state.getClass1Collateral(agent);
        require(_agentMinCollateralRatioBIPS >= collateral.minCollateralRatioBIPS,
            "collateral ratio too small");
        agent.agentMinCollateralRatioBIPS = _agentMinCollateralRatioBIPS.toUint32();
    }
    
    function allocateMintedAssets(
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_agentVault);
        agent.mintedAMG = agent.mintedAMG + _valueAMG;
    }

    function releaseMintedAssets(
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_agentVault);
        agent.mintedAMG = SafeMath64.sub64(agent.mintedAMG, _valueAMG, "not enough minted");
    }

    function startRedeemingAssets(
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_agentVault);
        agent.redeemingAMG = agent.redeemingAMG + _valueAMG;
        agent.mintedAMG = SafeMath64.sub64(agent.mintedAMG, _valueAMG, "not enough minted");
    }

    function endRedeemingAssets(
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_agentVault);
        agent.redeemingAMG = SafeMath64.sub64(agent.redeemingAMG, _valueAMG, "not enough redeeming");
    }
    
    function announceWithdrawal(
        address _agentVault,
        uint256 _valueNATWei
    )
        external
    {
        Agent.State storage agent = getAgent(_agentVault);
        requireAgentVaultOwner(_agentVault);
        require(agent.status == Agent.Status.NORMAL, "withdrawal ann: invalid status");
        if (_valueNATWei > agent.withdrawalAnnouncedNATWei) {
            Collateral.Data memory collateralData = 
                AgentCollateral.agentClass1CollateralData(agent, _agentVault);
            // announcement increased - must check there is enough free collateral and then lock it
            // in this case the wait to withdrawal restarts from this moment
            uint256 increase = _valueNATWei - agent.withdrawalAnnouncedNATWei;
            require(increase <= collateralData.freeCollateralWei(agent),
                "withdrawal: value too high");
            agent.withdrawalAnnouncedAt = block.timestamp.toUint64();
        } else {
            // announcement decreased or cancelled
            // if value is 0, we cancel announcement completely (i.e. set announcement time to 0)
            // otherwise, for decreasing announcement, we can safely leave announcement time unchanged
            if (_valueNATWei == 0) {
                agent.withdrawalAnnouncedAt = 0;
            }
        }
        agent.withdrawalAnnouncedNATWei = _valueNATWei.toUint128();
        emit AMEvents.CollateralWithdrawalAnnounced(_agentVault, _valueNATWei, agent.withdrawalAnnouncedAt);
    }

    function changeDust(
        address _agentVault,
        uint64 _newDustAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_agentVault);
        agent.dustAMG = _newDustAMG;
        uint256 dustUBA = Conversion.convertAmgToUBA(_newDustAMG);
        emit AMEvents.DustChanged(_agentVault, dustUBA);
    }

    function increaseDust(
        address _agentVault,
        uint64 _dustIncreaseAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_agentVault);
        uint64 newDustAMG = agent.dustAMG + _dustIncreaseAMG;
        agent.dustAMG = newDustAMG;
        uint256 dustUBA = Conversion.convertAmgToUBA(newDustAMG);
        emit AMEvents.DustChanged(_agentVault, dustUBA);
    }

    function decreaseDust(
        address _agentVault,
        uint64 _dustDecreaseAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_agentVault);
        uint64 newDustAMG = SafeMath64.sub64(agent.dustAMG, _dustDecreaseAMG, "not enough dust");
        agent.dustAMG = newDustAMG;
        uint256 dustUBA = Conversion.convertAmgToUBA(newDustAMG);
        emit AMEvents.DustChanged(_agentVault, dustUBA);
    }
    
    function convertDustToTicket(
        address _agentVault
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = getAgent(_agentVault);
        // if dust is more than 1 lot, create a new redemption ticket
        if (agent.dustAMG >= state.settings.lotSizeAMG) {
            uint64 remainingDustAMG = agent.dustAMG % state.settings.lotSizeAMG;
            uint64 ticketValueAMG = agent.dustAMG - remainingDustAMG;
            uint64 ticketId = state.redemptionQueue.createRedemptionTicket(_agentVault, ticketValueAMG);
            agent.dustAMG = remainingDustAMG;
            uint256 ticketValueUBA = Conversion.convertAmgToUBA(ticketValueAMG);
            emit AMEvents.DustConvertedToTicket(_agentVault, ticketId, ticketValueUBA);
            uint256 dustUBA = Conversion.convertAmgToUBA(remainingDustAMG);
            emit AMEvents.DustChanged(_agentVault, dustUBA);
        }
    }
    
    function depositExecuted(
        IERC20 _token,
        address _agentVault
    )
        external
    {
        // TODO: buy pool tokens if NATs are deposited?
        // for now, only try to pull agent out of liquidation
        if (isCollateralToken(_agentVault, _token)) {
            Liquidation.endLiquidationIfHealthy(_agentVault);
        }
    }
    
    function withdrawalExecuted(
        IERC20 _token,
        address _agentVault,
        uint256 _valueNATWei
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = getAgent(_agentVault);
        require (_token != agent.collateralPool.poolToken(), "cannot withdraw pool tokens");
        // we only care about agent's collateral class1 tokens and pool tokens
        if (_token != state.getClass1Token(agent)) return;
        require(agent.status == Agent.Status.NORMAL, "withdrawal: invalid status");
        require(agent.withdrawalAnnouncedAt != 0, "withdrawal: not announced");
        require(_valueNATWei <= agent.withdrawalAnnouncedNATWei, "withdrawal: more than announced");
        require(block.timestamp > agent.withdrawalAnnouncedAt + state.settings.withdrawalWaitMinSeconds,
            "withdrawal: not allowed yet");
        agent.withdrawalAnnouncedNATWei -= uint128(_valueNATWei);    // guarded by above require
        // could reset agent.withdrawalAnnouncedAt if agent.withdrawalAnnouncedNATWei == 0, 
        // but it's not needed, since no withdrawal can be made anyway
    }

    function payoutClass1(
        Agent.State storage _agent,
        address _agentVault,
        address _receiver,
        uint256 _amountWei
    )
        internal
        returns (uint256 _amountPaid)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        CollateralToken.Data storage collateral = state.getClass1Collateral(_agent);
        // don't want the calling method to fail due to too small balance for payout
        _amountPaid = Math.min(_amountWei, collateral.token.balanceOf(_agentVault));
        IAgentVault vault = IAgentVault(_agentVault);
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
        address _agentVault,
        uint256 _amountNATWei
    )
        internal
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        IAgentVault vault = IAgentVault(_agentVault);
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
    
    function getAgent(
        address _agentVault
    ) 
        internal view 
        returns (Agent.State storage _agent) 
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        _agent = state.agents[_agentVault];
        require(_agent.agentType != Agent.Type.NONE, "invalid agent vault address");
    }

    function getAgentNoCheck(
        address _agentVault
    ) 
        internal view 
        returns (Agent.State storage _agent) 
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        _agent = state.agents[_agentVault];
        require(_agent.agentType != Agent.Type.NONE, "invalid agent vault address");
    }

    function vaultOwner(address _agentVault) internal view returns (address) {
        return IAgentVault(_agentVault).owner();
    }
    
    function requireAgentVaultOwner(address _agentVault) internal view {
        address owner = IAgentVault(_agentVault).owner();
        require(msg.sender == owner, "only agent vault owner");
    }
    
    function isCollateralToken(
        address _agentVault,
        IERC20 _token
    ) 
        internal view 
        returns (bool)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = getAgent(_agentVault);
        return _token == state.getWNat() || _token == state.getClass1Token(agent);
    }
}
