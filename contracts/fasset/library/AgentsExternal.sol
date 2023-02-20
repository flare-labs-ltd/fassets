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

library AgentsExternal {
    using SafeBips for uint256;
    using SafeCast for uint256;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    using RedemptionQueue for RedemptionQueue.State;
    using AgentCollateral for Collateral.Data;
    using AssetManagerState for AssetManagerState.State;
    using Agent for Agent.State;
    
    modifier onlyAgentVaultOwner(address _agentVault) {
        Agents.requireAgentVaultOwner(_agentVault);
        _;
    }
    
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
        Agent.State storage agent = Agent.getWithoutCheck(address(agentVault));
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
        onlyAgentVaultOwner(_agentVault)
    {
        Agent.State storage agent = Agent.get(_agentVault);
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
        onlyAgentVaultOwner(_agentVault)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
        // destroy must have been announced enough time before
        require(agent.status == Agent.Status.DESTROYING, "destroy not announced");
        require(block.timestamp > agent.withdrawalAnnouncedAt + state.settings.withdrawalWaitMinSeconds,
            "destroy: not allowed yet");
        // cannot have any minting when in destroying status
        assert(agent.mintedAMG == 0 && agent.reservedAMG == 0 && agent.redeemingAMG == 0);
        // delete agent data
        Agent.deleteStorage(agent);
        // destroy agent vault
        IAgentVault(_agentVault).destroy();
        // notify
        emit AMEvents.AgentDestroyed(_agentVault);
    }
    
    function buybackAgentCollateral(
        address _agentVault
    )
        external
        onlyAgentVaultOwner(_agentVault)
    {
        // check that fAsset is terminated is in AssetManager
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
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
        Agents.burnCollateral(agent, buybackCollateral);
        agent.mintedAMG = 0;
        state.totalReservedCollateralAMG -= agent.reservedAMG;
        agent.reservedAMG = 0;
    }
    
    function setAgentMinCollateralRatioBIPS(
        address _agentVault,
        uint256 _agentMinCollateralRatioBIPS
    )
        external
        onlyAgentVaultOwner(_agentVault)
    {
        Agents.setAgentMinCollateralRatioBIPS(Agent.get(_agentVault), _agentMinCollateralRatioBIPS);
    }
    
    // TODO: support multicollateral
    function announceWithdrawal(
        address _agentVault,
        uint256 _valueNATWei
    )
        external
        onlyAgentVaultOwner(_agentVault)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        require(agent.status == Agent.Status.NORMAL, "withdrawal ann: invalid status");
        if (_valueNATWei > agent.withdrawalAnnouncedNATWei) {
            Collateral.Data memory collateralData = AgentCollateral.agentClass1CollateralData(agent);
            // announcement increased - must check there is enough free collateral and then lock it
            // in this case the wait to withdrawal restarts from this moment
            uint256 increase = _valueNATWei - agent.withdrawalAnnouncedNATWei;
            require(increase <= collateralData.freeCollateralWei(agent), "withdrawal: value too high");
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

    function convertDustToTicket(
        address _agentVault
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
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
        Agent.State storage agent = Agent.get(_agentVault);
        // TODO: buy pool tokens if NATs are deposited?
        // for now, only try to pull agent out of liquidation
        if (Agents.isCollateralToken(agent, _token)) {
            Liquidation.endLiquidationIfHealthy(agent);
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
        Agent.State storage agent = Agent.get(_agentVault);
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

    function isCollateralToken(
        address _agentVault,
        IERC20 _token
    ) 
        external view 
        returns (bool)
    {
        Agent.State storage agent = Agent.get(_agentVault);
        return Agents.isCollateralToken(agent, _token);
    }
}
