// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interface/IIAssetManager.sol";
import "../interface/ICollateralPoolFactory.sol";
import "../interface/ICollateralPoolTokenFactory.sol";
import "../interface/IAgentVaultFactory.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafePct.sol";
import "./data/AssetManagerState.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";
import "./AgentSettingsUpdater.sol";
import "./UnderlyingAddresses.sol";


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

    function setOwnerWorkAddress(address _ownerWorkAddress)
        external
        onlyWhitelistedAgent
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        require(_ownerWorkAddress == address(0) || state.ownerWorkToMgmtAddress[_ownerWorkAddress] == address(0),
            "work address in use");
        // delete old work to management mapping
        address oldWorkAddress = state.ownerMgmtToWorkAddress[msg.sender];
        if (oldWorkAddress != address(0)) {
            state.ownerWorkToMgmtAddress[oldWorkAddress] = address(0);
        }
        // create a new bidirectional mapping
        state.ownerMgmtToWorkAddress[msg.sender] = _ownerWorkAddress;
        if (_ownerWorkAddress != address(0)) {
            state.ownerWorkToMgmtAddress[_ownerWorkAddress] = msg.sender;
        }
    }

    function claimAddressWithEOAProof(
        ISCProofVerifier.Payment calldata _payment
    )
        external
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        TransactionAttestation.verifyPaymentSuccess(_payment);
        address ownerManagementAddress = _getManagementAddress(msg.sender);
        Agents.requireWhitelisted(ownerManagementAddress);
        state.underlyingAddressOwnership.claimWithProof(_payment, state.paymentConfirmations, ownerManagementAddress);
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

    function createAgentVault(
        IIAssetManager _assetManager,
        AgentSettings.Data calldata _settings
    )
        external
        returns (address)
    {
        AssetManagerState.State storage state = AssetManagerState.get();
        // can be called from management or work owner address
        address ownerManagementAddress = _getManagementAddress(msg.sender);
        // management address must be whitelisted
        Agents.requireWhitelisted(ownerManagementAddress);
        // validate underlying address
        (string memory normalizedUnderlyingAddress, bytes32 underlyingAddressHash) =
            UnderlyingAddresses.validateAndNormalize(_settings.underlyingAddressString);
        // create agent vault
        IAgentVaultFactory agentVaultFactory = IAgentVaultFactory(state.settings.agentVaultFactory);
        IIAgentVault agentVault = agentVaultFactory.create(_assetManager);
        // set initial status
        Agent.State storage agent = Agent.getWithoutCheck(address(agentVault));
        assert(agent.status == Agent.Status.EMPTY);     // state should be empty on creation
        agent.status = Agent.Status.NORMAL;
        agent.ownerManagementAddress = ownerManagementAddress;
        // set collateral token types
        agent.setVaultCollateral(_settings.vaultCollateralToken);
        agent.poolCollateralIndex = state.poolCollateralIndex;
        // set initial collateral ratios
        agent.setMintingVaultCollateralRatioBIPS(_settings.mintingVaultCollateralRatioBIPS);
        agent.setMintingPoolCollateralRatioBIPS(_settings.mintingPoolCollateralRatioBIPS);
        // set minting fee and share
        agent.setFeeBIPS(_settings.feeBIPS);
        agent.setPoolFeeShareBIPS(_settings.poolFeeShareBIPS);
        agent.setBuyFAssetByAgentFactorBIPS(_settings.buyFAssetByAgentFactorBIPS);
        // claim the address to make sure no other agent is using it
        // for chains where this is required, also checks that address was proved to be EOA
        state.underlyingAddressOwnership.claim(ownerManagementAddress, underlyingAddressHash,
            state.settings.requireEOAAddressProof);
        agent.underlyingAddressString = normalizedUnderlyingAddress;
        agent.underlyingAddressHash = underlyingAddressHash;
        uint64 eoaProofBlock = state.underlyingAddressOwnership.underlyingBlockOfEOAProof(underlyingAddressHash);
        agent.underlyingBlockAtCreation = SafeMath64.max64(state.currentUnderlyingBlock, eoaProofBlock + 1);
        // add collateral pool
        agent.collateralPool = _createCollateralPool(_assetManager, address(agentVault), _settings);
        // run the pool setters just for validation
        agent.setPoolExitCollateralRatioBIPS(_settings.poolExitCollateralRatioBIPS);
        agent.setPoolTopupCollateralRatioBIPS(_settings.poolTopupCollateralRatioBIPS);
        agent.setPoolTopupTokenPriceFactorBIPS(_settings.poolTopupTokenPriceFactorBIPS);
        // add to the list of all agents
        agent.allAgentsPos = state.allAgents.length.toUint32();
        state.allAgents.push(address(agentVault));
        // notify
        _emitAgentVaultCreated(ownerManagementAddress, address(agentVault), address(agent.collateralPool),
            normalizedUnderlyingAddress, _settings);
        return address(agentVault);
    }

    function announceDestroy(
        address _agentVault
    )
        external
        onlyAgentVaultOwner(_agentVault)
        returns (uint256)
    {
        AssetManagerSettings.Data storage settings = AssetManagerState.getSettings();
        Agent.State storage agent = Agent.get(_agentVault);
        // all minting must stop and all minted assets must have been cleared
        require(agent.availableAgentsPos == 0, "agent still available");
        require(agent.totalBackedAMG() == 0, "agent still active");
        // if not destroying yet, start timing
        if (agent.status != Agent.Status.DESTROYING) {
            agent.status = Agent.Status.DESTROYING;
            uint256 destroyAllowedAt = block.timestamp + settings.withdrawalWaitMinSeconds;
            agent.destroyAllowedAt = destroyAllowedAt.toUint64();
            emit AMEvents.AgentDestroyAnnounced(_agentVault, destroyAllowedAt);
        }
        return agent.destroyAllowedAt;
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
        assert(agent.totalBackedAMG() == 0);
        // destroy pool
        agent.collateralPool.destroy(_recipient);
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
        CollateralTypeInt.Data storage collateral = agent.getVaultCollateral();
        uint256 amgToTokenWeiPrice = Conversion.currentAmgPriceInTokenWei(collateral);
        uint256 buybackCollateral = Conversion.convertAmgToTokenWei(mintingAMG, amgToTokenWeiPrice)
            .mulBips(state.settings.buybackCollateralFactorBIPS);
        agent.burnVaultCollateral(buybackCollateral);
        agent.mintedAMG = 0;
        state.totalReservedCollateralAMG -= agent.reservedAMG;
        agent.reservedAMG = 0;
    }

    function _createCollateralPool(
        IIAssetManager _assetManager,
        address _agentVault,
        AgentSettings.Data calldata _settings
    )
        private
        returns (IICollateralPool)
    {
        AssetManagerSettings.Data storage globalSettings = AssetManagerState.getSettings();
        ICollateralPoolFactory collateralPoolFactory =
            ICollateralPoolFactory(globalSettings.collateralPoolFactory);
        IICollateralPool collateralPool = collateralPoolFactory.create(_assetManager, _agentVault, _settings);
        collateralPool.setPoolToken(
            ICollateralPoolTokenFactory(globalSettings.collateralPoolTokenFactory).create(collateralPool));
        return collateralPool;
    }

    // Basically the same as `emit AMEvents.AgentVaultCreated`.
    // Must be a separate method as workaround for EVM 16 stack variables limit.
    function _emitAgentVaultCreated(
        address _ownerManagementAddress,
        address _agentVault,
        address _collateralPool,
        string memory _underlyingAddress,
        AgentSettings.Data calldata _settings
    )
        private
    {
        emit AMEvents.AgentVaultCreated(_ownerManagementAddress, _agentVault, _collateralPool, _underlyingAddress,
            address(_settings.vaultCollateralToken), _settings.feeBIPS, _settings.poolFeeShareBIPS,
            _settings.mintingVaultCollateralRatioBIPS, _settings.mintingPoolCollateralRatioBIPS,
            _settings.buyFAssetByAgentFactorBIPS, _settings.poolExitCollateralRatioBIPS,
            _settings.poolTopupCollateralRatioBIPS, _settings.poolTopupTokenPriceFactorBIPS);
    }

    // Returns management owner's address, given either work or management address.
    function _getManagementAddress(address _ownerAddress) private view returns (address) {
        AssetManagerState.State storage state = AssetManagerState.get();
        address ownerManagementAddress = state.ownerWorkToMgmtAddress[_ownerAddress];
        return ownerManagementAddress != address(0) ? ownerManagementAddress : _ownerAddress;
    }
}
