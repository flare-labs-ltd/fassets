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
    using AgentCollateral for AgentCollateral.CollateralData;
    using AssetManagerState for AssetManagerState.State;
    
    
    function claimAddressWithEOAProof(
        AssetManagerState.State storage _state,
        IAttestationClient.Payment calldata _payment
    )
        external
    {
        TransactionAttestation.verifyPaymentSuccess(_state.settings, _payment);
        _state.underlyingAddressOwnership.claimWithProof(_payment, _state.paymentConfirmations, msg.sender);
        // Make sure that current underlying block is at least as high as the EOA proof block.
        // This ensures that any transaction done at or before EOA check cannot be used as payment proof for minting.
        // It prevents the attack where an agent guesses the minting id, pays to the underlying address,
        // then removes all in EOA proof transaction (or a transaction before EOA proof) and finally uses the
        // proof of transaction for minting.
        // Since we have a proof of the block N, current block is at least N+1.
        uint64 leastCurrentBlock = _payment.blockNumber + 1;
        if (leastCurrentBlock > _state.currentUnderlyingBlock) {
            _state.currentUnderlyingBlock = leastCurrentBlock;
        }
    }
    
    function createAgent(
        AssetManagerState.State storage _state, 
        Agent.Type _agentType,
        IAssetManager _assetManager,
        string memory _underlyingAddressString,
        uint256 _collateralTokenClass1
    ) 
        external
    {
        IAgentVaultFactory agentVaultFactory = _state.settings.agentVaultFactory;
        IAgentVault agentVault = agentVaultFactory.create(_assetManager, payable(msg.sender));
        Agent.State storage agent = _state.agents[address(agentVault)];
        assert(agent.agentType == Agent.Type.NONE);
        assert(_agentType == Agent.Type.AGENT_100); // AGENT_0 not supported yet
        require(bytes(_underlyingAddressString).length != 0, "empty underlying address");
        agent.agentType = _agentType;
        agent.status = Agent.Status.NORMAL;
        // set collateral token type
        require(_collateralTokenClass1 >= 1 && _collateralTokenClass1 < _state.collateralTokens.length,
            "invalid collateral token index");
        CollateralToken.Data storage collateral = _state.collateralTokens[_collateralTokenClass1];
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
        _state.underlyingAddressOwnership.claim(msg.sender, underlyingAddressHash, 
            _state.settings.requireEOAAddressProof);
        agent.underlyingAddressString = _underlyingAddressString;
        agent.underlyingAddressHash = underlyingAddressHash;
        uint64 eoaProofBlock = _state.underlyingAddressOwnership.underlyingBlockOfEOAProof(underlyingAddressHash);
        agent.underlyingBlockAtCreation = SafeMath64.max64(_state.currentUnderlyingBlock, eoaProofBlock + 1);
        emit AMEvents.AgentCreated(msg.sender, uint8(_agentType), address(agentVault), _underlyingAddressString);
    }
    
    function announceDestroy(
        AssetManagerState.State storage _state, 
        address _agentVault
    )
        external
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
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
        AssetManagerState.State storage _state, 
        address _agentVault
    )
        external
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        requireAgentVaultOwner(_agentVault);
        // destroy must have been announced enough time before
        require(agent.status == Agent.Status.DESTROYING, "destroy not announced");
        require(block.timestamp > agent.withdrawalAnnouncedAt + _state.settings.withdrawalWaitMinSeconds,
            "destroy: not allowed yet");
        // cannot have any minting when in destroying status
        assert(agent.mintedAMG == 0 && agent.reservedAMG == 0 && agent.redeemingAMG == 0);
        // delete agent data
        delete _state.agents[_agentVault];
        // destroy agent vault
        IAgentVault(_agentVault).destroy();
        // notify
        emit AMEvents.AgentDestroyed(_agentVault);
    }
    
    function buybackAgentCollateral(
        AssetManagerState.State storage _state, 
        address _agentVault
    )
        external
    {
        // check that fAsset is terminated is in AssetManager
        Agent.State storage agent = getAgent(_state, _agentVault);
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
        CollateralToken.Data storage collateral = _state.getClass1Collateral(agent);
        uint256 amgToTokenWeiPrice = Conversion.currentAmgPriceInTokenWei(_state.settings, collateral);
        uint256 buybackCollateral = Conversion.convertAmgToTokenWei(mintingAMG, amgToTokenWeiPrice)
            .mulBips(_state.settings.buybackCollateralFactorBIPS);
        burnCollateral(_state, _agentVault, buybackCollateral);
        agent.mintedAMG = 0;
        _state.totalReservedCollateralAMG -= agent.reservedAMG;
        agent.reservedAMG = 0;
    }
    
    function setAgentMinCollateralRatioBIPS(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _agentMinCollateralRatioBIPS
    )
        internal
    {
        // TODO: add min pool collateral
        Agent.State storage agent = Agents.getAgent(_state, _agentVault);
        requireAgentVaultOwner(_agentVault);
        CollateralToken.Data storage collateral = _state.getClass1Collateral(agent);
        require(_agentMinCollateralRatioBIPS >= collateral.minCollateralRatioBIPS,
            "collateral ratio too small");
        agent.agentMinCollateralRatioBIPS = _agentMinCollateralRatioBIPS.toUint32();
    }
    
    function allocateMintedAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        agent.mintedAMG = agent.mintedAMG + _valueAMG;
    }

    function releaseMintedAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        agent.mintedAMG = SafeMath64.sub64(agent.mintedAMG, _valueAMG, "not enough minted");
    }

    function startRedeemingAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        agent.redeemingAMG = agent.redeemingAMG + _valueAMG;
        agent.mintedAMG = SafeMath64.sub64(agent.mintedAMG, _valueAMG, "not enough minted");
    }

    function endRedeemingAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        agent.redeemingAMG = SafeMath64.sub64(agent.redeemingAMG, _valueAMG, "not enough redeeming");
    }
    
    function announceWithdrawal(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _valueNATWei
    )
        external
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        requireAgentVaultOwner(_agentVault);
        require(agent.status == Agent.Status.NORMAL, "withdrawal ann: invalid status");
        if (_valueNATWei > agent.withdrawalAnnouncedNATWei) {
            AgentCollateral.CollateralData memory collateralData = 
                AgentCollateral.agentClass1CollateralData(_state, agent, _agentVault);
            // announcement increased - must check there is enough free collateral and then lock it
            // in this case the wait to withdrawal restarts from this moment
            uint256 increase = _valueNATWei - agent.withdrawalAnnouncedNATWei;
            require(increase <= collateralData.freeCollateralWei(_state, agent),
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
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _newDustAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        agent.dustAMG = _newDustAMG;
        uint256 dustUBA = Conversion.convertAmgToUBA(_state.settings, _newDustAMG);
        emit AMEvents.DustChanged(_agentVault, dustUBA);
    }

    function increaseDust(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _dustIncreaseAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        uint64 newDustAMG = agent.dustAMG + _dustIncreaseAMG;
        agent.dustAMG = newDustAMG;
        uint256 dustUBA = Conversion.convertAmgToUBA(_state.settings, newDustAMG);
        emit AMEvents.DustChanged(_agentVault, dustUBA);
    }

    function decreaseDust(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _dustDecreaseAMG
    )
        internal
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        uint64 newDustAMG = SafeMath64.sub64(agent.dustAMG, _dustDecreaseAMG, "not enough dust");
        agent.dustAMG = newDustAMG;
        uint256 dustUBA = Conversion.convertAmgToUBA(_state.settings, newDustAMG);
        emit AMEvents.DustChanged(_agentVault, dustUBA);
    }
    
    function convertDustToTicket(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        external
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        // if dust is more than 1 lot, create a new redemption ticket
        if (agent.dustAMG >= _state.settings.lotSizeAMG) {
            uint64 remainingDustAMG = agent.dustAMG % _state.settings.lotSizeAMG;
            uint64 ticketValueAMG = agent.dustAMG - remainingDustAMG;
            uint64 ticketId = _state.redemptionQueue.createRedemptionTicket(_agentVault, ticketValueAMG);
            agent.dustAMG = remainingDustAMG;
            uint256 ticketValueUBA = Conversion.convertAmgToUBA(_state.settings, ticketValueAMG);
            emit AMEvents.DustConvertedToTicket(_agentVault, ticketId, ticketValueUBA);
            uint256 dustUBA = Conversion.convertAmgToUBA(_state.settings, remainingDustAMG);
            emit AMEvents.DustChanged(_agentVault, dustUBA);
        }
    }
    
    function depositExecuted(
        AssetManagerState.State storage _state, 
        IERC20 _token,
        address _agentVault
    )
        external
    {
        // TODO: buy pool tokens if NATs are deposited?
        // for now, only try to pull agent out of liquidation
        if (isCollateralToken(_state, _agentVault, _token)) {
            Liquidation.endLiquidationIfHealthy(_state, _agentVault);
        }
    }
    
    function withdrawalExecuted(
        AssetManagerState.State storage _state, 
        IERC20 _token,
        address _agentVault,
        uint256 _valueNATWei
    )
        external
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        require (_token != agent.collateralPool.poolToken(), "cannot withdraw pool tokens");
        // we only care about agent's collateral class1 tokens and pool tokens
        if (_token != _state.getClass1Token(agent)) return;
        require(agent.status == Agent.Status.NORMAL, "withdrawal: invalid status");
        require(agent.withdrawalAnnouncedAt != 0, "withdrawal: not announced");
        require(_valueNATWei <= agent.withdrawalAnnouncedNATWei, "withdrawal: more than announced");
        require(block.timestamp > agent.withdrawalAnnouncedAt + _state.settings.withdrawalWaitMinSeconds,
            "withdrawal: not allowed yet");
        agent.withdrawalAnnouncedNATWei -= uint128(_valueNATWei);    // guarded by above require
        // could reset agent.withdrawalAnnouncedAt if agent.withdrawalAnnouncedNATWei == 0, 
        // but it's not needed, since no withdrawal can be made anyway
    }

    function payoutClass1(
        AssetManagerState.State storage _state, 
        Agent.State storage _agent,
        address _agentVault,
        address _receiver,
        uint256 _amountWei
    )
        internal
        returns (uint256 _amountPaid)
    {
        CollateralToken.Data storage collateral = _state.getClass1Collateral(_agent);
        // don't want the calling method to fail due to too small balance for payout
        _amountPaid = Math.min(_amountWei, collateral.token.balanceOf(_agentVault));
        IAgentVault vault = IAgentVault(_agentVault);
        vault.payout(collateral.token, _receiver, _amountPaid);
    }

    function payoutFromPool(
        AssetManagerState.State storage _state, 
        Agent.State storage _agent,
        address _receiver,
        uint256 _amountWei,
        uint256 _agentResponsibilityWei
    )
        internal
        returns (uint256 _amountPaid)
    {
        // don't want the calling method to fail due to too small balance for payout
        _amountPaid = Math.min(_amountWei, _state.getWNat().balanceOf(address(_agent.collateralPool)));
        _agentResponsibilityWei = Math.min(_agentResponsibilityWei, _amountPaid);
        _agent.collateralPool.payout(_receiver, _amountPaid, _agentResponsibilityWei);
    }
    
    function burnCollateral(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _amountNATWei
    )
        internal
    {
        IAgentVault vault = IAgentVault(_agentVault);
        if (_state.settings.burnWithSelfDestruct) {
            // burn by self-destructing a temporary burner contract
            NativeTokenBurner burner = new NativeTokenBurner(_state.settings.burnAddress);
            vault.payoutNAT(_state.getWNat(), payable(address(burner)), _amountNATWei);
            burner.die();
        } else {
            // burn directly to burn address
            vault.payoutNAT(_state.getWNat(), _state.settings.burnAddress, _amountNATWei);
        }
    }
    
    function getAgent(
        AssetManagerState.State storage _state, 
        address _agentVault
    ) 
        internal view 
        returns (Agent.State storage _agent) 
    {
        _agent = _state.agents[_agentVault];
        require(_agent.agentType != Agent.Type.NONE, "invalid agent vault address");
    }

    function getAgentNoCheck(
        AssetManagerState.State storage _state, 
        address _agentVault
    ) 
        internal view 
        returns (Agent.State storage _agent) 
    {
        _agent = _state.agents[_agentVault];
    }
    
    function vaultOwner(address _agentVault) internal view returns (address) {
        return IAgentVault(_agentVault).owner();
    }
    
    function requireAgentVaultOwner(address _agentVault) internal view {
        address owner = IAgentVault(_agentVault).owner();
        require(msg.sender == owner, "only agent vault owner");
    }
    
    function isCollateralToken(
        AssetManagerState.State storage _state, 
        address _agentVault,
        IERC20 _token
    ) 
        internal view 
        returns (bool)
    {
        Agent.State storage agent = getAgent(_state, _agentVault);
        return _token == _state.getWNat() || _token == _state.getClass1Token(agent);
    }
}
