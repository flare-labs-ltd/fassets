// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interface/IIAssetManager.sol";
import "../interface/ICollateralPoolFactory.sol";
import "../interface/IAgentVaultFactory.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";
import "./AgentSettingsUpdater.sol";

library AgentsCreateDestroy {
    using SafePct for uint256;
    using SafeCast for uint256;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    using Agent for Agent.State;
    using Agents for Agent.State;

    modifier onlyAgentVaultOwner(address _agentVault) {
        Agents.requireAgentVaultOwner(_agentVault);
        _;
    }

    modifier onlyWhitelistedAgent {
        Agents.requireWhitelisted(msg.sender);
        _;
    }

    function setOwnerHotAddress(address _ownerHotAddress)
        external
        onlyWhitelistedAgent
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(_ownerHotAddress == address(0) || state.ownerHotToCold[_ownerHotAddress] == address(0),
            "hot address in use");
        // delete old hot to cold mapping
        address oldHotAddress = state.ownerColdToHot[msg.sender];
        if (oldHotAddress != address(0)) {
            state.ownerHotToCold[oldHotAddress] = address(0);
        }
        // create a new bidirectional mapping
        state.ownerColdToHot[msg.sender] = _ownerHotAddress;
        if (_ownerHotAddress != address(0)) {
            state.ownerHotToCold[_ownerHotAddress] = msg.sender;
        }
    }

    function claimAddressWithEOAProof(
        IAttestationClient.Payment calldata _payment
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        TransactionAttestation.verifyPaymentSuccess(_payment);
        address ownerColdAddress = _getColdAddress(msg.sender);
        Agents.requireWhitelisted(ownerColdAddress);
        state.underlyingAddressOwnership.claimWithProof(_payment, state.paymentConfirmations, ownerColdAddress);
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
        IIAssetManager _assetManager,
        AgentCreateSettings.Data calldata _settings
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // can be called from cold or hot owner address
        address ownerColdAddress = _getColdAddress(msg.sender);
        // cold address must be whitelisted
        Agents.requireWhitelisted(ownerColdAddress);
        // validate underlying address
        (string memory normalizedUnderlyingAddress, bytes32 underlyingAddressHash) =
            Globals.validateAndNormalizeUnderlyingAddress(_settings.underlyingAddressString);
        // create agent vault
        IAgentVaultFactory agentVaultFactory = IAgentVaultFactory(state.settings.agentVaultFactory);
        IIAgentVault agentVault = agentVaultFactory.create(_assetManager);
        // set initial status
        Agent.State storage agent = Agent.getWithoutCheck(address(agentVault));
        assert(agent.status == Agent.Status.EMPTY);     // state should be empty on creation
        agent.status = Agent.Status.NORMAL;
        agent.ownerColdAddress = ownerColdAddress;
        // set collateral token types
        agent.setClass1Collateral(_settings.class1CollateralToken);
        agent.poolCollateralIndex = state.poolCollateralIndex;
        // set initial collateral ratios
        agent.setMintingClass1CollateralRatioBIPS(_settings.mintingClass1CollateralRatioBIPS);
        agent.setMintingPoolCollateralRatioBIPS(_settings.mintingPoolCollateralRatioBIPS);
        // set minting fee and share
        agent.setFeeBIPS(_settings.feeBIPS);
        agent.setPoolFeeShareBIPS(_settings.poolFeeShareBIPS);
        agent.setBuyFAssetByAgentFactorBIPS(_settings.buyFAssetByAgentFactorBIPS);
        // claim the address to make sure no other agent is using it
        // for chains where this is required, also checks that address was proved to be EOA
        state.underlyingAddressOwnership.claim(ownerColdAddress, underlyingAddressHash,
            state.settings.requireEOAAddressProof);
        agent.underlyingAddressString = normalizedUnderlyingAddress;
        agent.underlyingAddressHash = underlyingAddressHash;
        uint64 eoaProofBlock = state.underlyingAddressOwnership.underlyingBlockOfEOAProof(underlyingAddressHash);
        agent.underlyingBlockAtCreation = SafeMath64.max64(state.currentUnderlyingBlock, eoaProofBlock + 1);
        // add collateral pool
        ICollateralPoolFactory collateralPoolFactory = ICollateralPoolFactory(state.settings.collateralPoolFactory);
        agent.collateralPool = collateralPoolFactory.create(_assetManager, address(agentVault), _settings);
        agent.collateralPool.setPoolToken(collateralPoolFactory.createPoolToken(agent.collateralPool));
        // run the pool setters just for validation
        agent.setPoolExitCollateralRatioBIPS(_settings.poolExitCollateralRatioBIPS);
        agent.setPoolTopupCollateralRatioBIPS(_settings.poolTopupCollateralRatioBIPS);
        agent.setPoolTopupTokenPriceFactorBIPS(_settings.poolTopupTokenPriceFactorBIPS);
        // add to the list of all agents
        agent.allAgentsPos = state.allAgents.length.toUint32();
        state.allAgents.push(address(agentVault));
        // notify
        emitAgentCreated(ownerColdAddress, address(agentVault), address(agent.collateralPool),
            normalizedUnderlyingAddress, _settings);
    }

    function announceDestroy(
        address _agentVault
    )
        external
        onlyAgentVaultOwner(_agentVault)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        Agent.State storage agent = Agent.get(_agentVault);
        // all minting must stop and all minted assets must have been cleared
        require(agent.availableAgentsPos == 0, "agent still available");
        require(agent.mintedAMG == 0 && agent.reservedAMG == 0 && agent.redeemingAMG == 0, "agent still active");
        assert(agent.poolRedeemingAMG == 0);    // must be <= redeemingAMG
        // if not destroying yet, start timing
        if (agent.status != Agent.Status.DESTROYING) {
            agent.status = Agent.Status.DESTROYING;
            uint256 destroyAllowedAt = block.timestamp + settings.withdrawalWaitMinSeconds;
            agent.destroyAllowedAt = destroyAllowedAt.toUint64();
            emit AMEvents.AgentDestroyAnnounced(_agentVault, destroyAllowedAt);
        }
    }

    function destroyAgent(
        address _agentVault,
        address payable _recipient
    )
        external
        onlyAgentVaultOwner(_agentVault)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        Agent.State storage agent = Agent.get(_agentVault);
        // destroy must have been announced enough time before
        require(agent.status == Agent.Status.DESTROYING, "destroy not announced");
        require(block.timestamp > agent.destroyAllowedAt, "destroy: not allowed yet");
        // cannot have any minting when in destroying status
        assert(agent.mintedAMG == 0 && agent.reservedAMG == 0 &&
            agent.redeemingAMG == 0 && agent.poolRedeemingAMG == 0);
        // destroy pool - just burn the remaining nat
        agent.collateralPool.destroy(state.settings.burnAddress);
        // destroy agent vault
        IIAgentVault(_agentVault).destroy(_recipient);
        // remove from the list of all agents
        uint256 ind = agent.allAgentsPos;
        if (ind + 1 < state.allAgents.length) {
            state.allAgents[ind] = state.allAgents[state.allAgents.length - 1];
            Agent.State storage movedAgent = Agent.get(state.allAgents[ind]);
            movedAgent.allAgentsPos = uint32(ind);
        }
        state.allAgents.pop();
        // delete agent data
        AgentSettingsUpdater.clearPendingUpdates(agent);
        Agent.deleteStorage(agent);
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
        // - redeemingAMG and poolRedeemingAMG corresponds to redemptions where f-assets were already burned,
        //   so the redemption can finish normally even if f-asset is now terminated
        //   If there are stuck redemptions due to lack of proof, agent should use finishRedemptionWithoutPayment.
        // - mintedAMG must be burned and cleared
        uint64 mintingAMG = agent.reservedAMG + agent.mintedAMG;
        CollateralTypeInt.Data storage collateral = agent.getClass1Collateral();
        uint256 amgToTokenWeiPrice = Conversion.currentAmgPriceInTokenWei(collateral);
        uint256 buybackCollateral = Conversion.convertAmgToTokenWei(mintingAMG, amgToTokenWeiPrice)
            .mulBips(state.settings.buybackCollateralFactorBIPS);
        agent.burnCollateralClass1(buybackCollateral);
        agent.mintedAMG = 0;
        state.totalReservedCollateralAMG -= agent.reservedAMG;
        agent.reservedAMG = 0;
    }

    // Basically the same as `emit AMEvents.AgentCreated`.
    // Must be a separate method as workaround for EVM 16 stack variables limit.
    function emitAgentCreated(
        address _ownerColdAddress,
        address _agentVault,
        address _collateralPool,
        string memory _underlyingAddress,
        AgentCreateSettings.Data calldata _settings
    )
        private
    {
        emit AMEvents.AgentCreated(_ownerColdAddress, _agentVault, _collateralPool, _underlyingAddress,
            address(_settings.class1CollateralToken), _settings.feeBIPS, _settings.poolFeeShareBIPS,
            _settings.mintingClass1CollateralRatioBIPS, _settings.mintingPoolCollateralRatioBIPS,
            _settings.buyFAssetByAgentFactorBIPS, _settings.poolExitCollateralRatioBIPS,
            _settings.poolTopupCollateralRatioBIPS, _settings.poolTopupTokenPriceFactorBIPS);
    }

    // Returns cold owner's address, given either hot or cold address.
    function _getColdAddress(address _ownerAddress) private view returns (address) {
        AssetManagerState.State storage state = AssetManagerState.get();
        address ownerColdAddress = state.ownerHotToCold[_ownerAddress];
        return ownerColdAddress != address(0) ? ownerColdAddress : _ownerAddress;
    }
}
