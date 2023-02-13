// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interface/ICollateralPool.sol";
import "../interface/IAssetManager.sol";
import "../../utils/implementation/NativeTokenBurner.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./RedemptionQueue.sol";
import "./UnderlyingAddressOwnership.sol";
import "./AssetManagerState.sol";
import "./AgentCollateral.sol";
import "./TransactionAttestation.sol";
import "./Liquidation.sol";

library Agents {
    using SafeBips for uint256;
    using SafePct for uint256;
    using SafeCast for uint256;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    using RedemptionQueue for RedemptionQueue.State;
    using AgentCollateral for AgentCollateral.Data;
    using AgentCollateral for AgentCollateral.CollateralData;
    using AssetManagerState for AssetManagerState.State;
    
    enum AgentType {
        NONE,
        AGENT_100,
        AGENT_0
    }
    
    enum AgentStatus {
        NORMAL,
        LIQUIDATION,        // CCB or liquidation due to CR - ends when agent is healthy
        FULL_LIQUIDATION,   // illegal payment liquidation - must liquidate all and close vault
        DESTROYING          // agent announced destroy, cannot mint again
    }

    enum LiquidationPhase {
        NONE,
        CCB,
        LIQUIDATION
    }
    
    struct Agent {
        ICollateralPool collateralPool;
        
        // Current address for underlying agent's collateral.
        // Agent can change this address anytime and it affects future mintings.
        string underlyingAddressString;
        
        // `underlyingAddressString` is only used for sending the minter a correct payment address;
        // for matching payment addresses we always use `underlyingAddressHash = keccak256(underlyingAddressString)`
        bytes32 underlyingAddressHash;
        
        // Amount of collateral locked by collateral reservation.
        uint64 reservedAMG;
        
        // Amount of collateral backing minted fassets.
        uint64 mintedAMG;
        
        // The amount of fassets being redeemed. In this case, the fassets were already burned,
        // but the collateral must still be locked to allow payment in case of redemption failure.
        // The distinction between 'minted' and 'redeemed' assets is important in case of challenge.
        uint64 redeemingAMG;
        
        // When lot size changes, there may be some leftover after redemtpion that doesn't fit
        // a whole lot size. It is added to dustAMG and can be recovered via self-close.
        // Unlike redeemingAMG, dustAMG is still counted in the mintedAMG.
        uint64 dustAMG;
        
        // Index of collateral class 1 token.
        // The data is obtained as state.collateralTokens[collateralTokenC1].
        uint16 collateralTokenC1;
        
        // Position of this agent in the list of agents available for minting.
        // Value is actually `list index + 1`, so that 0 means 'not in list'.
        uint64 availableAgentsPos;
        
        // Minting fee in BIPS (collected in underlying currency).
        uint16 feeBIPS;
        
        // Collateral ratio at which we calculate locked collateral and collateral available for minting.
        // Agent may set own value for minting collateral ratio when entering the available agent list,
        // but it must always be greater than minimum collateral ratio.
        uint32 agentMinCollateralRatioBIPS;

        // Collateral ratio at which we calculate locked collateral and collateral available for minting.
        // Agent may set own value for minting collateral ratio when entering the available agent list,
        // but it must always be greater than minimum collateral ratio.
        uint32 agentMinPoolCollateralRatioBIPS;
        
        // Timestamp of the startLiquidation call.
        // If the agent's CR is above ccbCR, agent is put into CCB state for a while.
        // However, if the agent's CR falls below ccbCR before ccb time expires, anyone can call startLiquidation
        // again to put agent in liquidation immediately (in this case, liquidationStartedAt and 
        // initialLiquidationPhase are reset to new values).
        uint64 liquidationStartedAt;
        
        // agent's type; EMPTY if agent doesn't exists
        AgentType agentType;
        
        // Current status of the agent (changes for liquidation).
        AgentStatus status;

        // Liquidation phase at the time when liquidation started.
        LiquidationPhase initialLiquidationPhase;
        
        // Bitmap signifying which collateral type(s) triggered liquidation (LF_CLASS1 | LF_POOL).
        uint8 collateralsUnderwater;
        
        // The amount of underlying funds that may be withdrawn by the agent
        // (fees, self-close, and amount released by liquidation).
        // May become negative (due to high underlying gas costs), in which case topup is required.
        int128 freeUnderlyingBalanceUBA;
        
        // There can be only one announced underlying withdrawal per agent active at any time.
        // This variable holds the id, or 0 if there is no announced underlying withdrawal going on.
        uint64 announcedUnderlyingWithdrawalId;

        // The time when ongoing underlying withdrawal was announced.
        uint64 underlyingWithdrawalAnnouncedAt;
        
        // For agents to withdraw NAT collateral, they must first announce it and then wait 
        // withdrawalAnnouncementSeconds. 
        // The announced amount cannot be used as collateral for minting during that time.
        // This makes sure that agents cannot just remove all collateral if they are challenged.
        uint128 withdrawalAnnouncedNATWei;
        
        // The time when withdrawal was announced.
        uint64 withdrawalAnnouncedAt;
        
        // Underlying block when the agent was created.
        // Challenger's should track underlying address activity since this block
        // and topups are only valid after this block (both inclusive).
        uint64 underlyingBlockAtCreation;
    }
    
    uint8 internal constant LF_CLASS1 = 1 << 0;
    uint8 internal constant LF_POOL = 1 << 1;
    
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
        AgentType _agentType,
        IAssetManager _assetManager,
        string memory _underlyingAddressString,
        uint256 _collateralTokenClass1
    ) 
        external 
    {
        IAgentVaultFactory agentVaultFactory = _state.settings.agentVaultFactory;
        IAgentVault agentVault = agentVaultFactory.create(_assetManager, payable(msg.sender));
        Agent storage agent = _state.agents[address(agentVault)];
        assert(agent.agentType == AgentType.NONE);
        assert(_agentType == AgentType.AGENT_100); // AGENT_0 not supported yet
        require(bytes(_underlyingAddressString).length != 0, "empty underlying address");
        agent.agentType = _agentType;
        agent.status = AgentStatus.NORMAL;
        // set collateral token type
        require(_collateralTokenClass1 >= 1 && _collateralTokenClass1 < _state.collateralTokens.length,
            "invalid collateral token index");
        CollateralToken.Token storage collateral = _state.collateralTokens[_collateralTokenClass1];
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
        Agent storage agent = getAgent(_state, _agentVault);
        requireAgentVaultOwner(_agentVault);
        // all minting must stop and all minted assets must have been cleared
        require(agent.availableAgentsPos == 0, "agent still available");
        require(agent.mintedAMG == 0 && agent.reservedAMG == 0 && agent.redeemingAMG == 0, "agent still active");
        // if not destroying yet, start timing
        if (agent.status != AgentStatus.DESTROYING) {
            agent.status = AgentStatus.DESTROYING;
            agent.withdrawalAnnouncedAt = SafeCast.toUint64(block.timestamp);
            emit AMEvents.AgentDestroyAnnounced(_agentVault, block.timestamp);
        }
    }

    function destroyAgent(
        AssetManagerState.State storage _state, 
        address _agentVault
    )
        external
    {
        Agent storage agent = getAgent(_state, _agentVault);
        requireAgentVaultOwner(_agentVault);
        // destroy must have been announced enough time before
        require(agent.status == AgentStatus.DESTROYING, "destroy not announced");
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
        Agent storage agent = getAgent(_state, _agentVault);
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
        CollateralToken.Token storage collateral = _state.getClass1Collateral(agent);
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
        Agent storage agent = Agents.getAgent(_state, _agentVault);
        requireAgentVaultOwner(_agentVault);
        CollateralToken.Token storage collateral = _state.getClass1Collateral(agent);
        require(_agentMinCollateralRatioBIPS >= collateral.minCollateralRatioBIPS,
            "collateral ratio too small");
        agent.agentMinCollateralRatioBIPS = SafeCast.toUint32(_agentMinCollateralRatioBIPS);
    }
    
    function allocateMintedAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent storage agent = getAgent(_state, _agentVault);
        agent.mintedAMG = agent.mintedAMG + _valueAMG;
    }

    function releaseMintedAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent storage agent = getAgent(_state, _agentVault);
        agent.mintedAMG = SafeMath64.sub64(agent.mintedAMG, _valueAMG, "not enough minted");
    }

    function startRedeemingAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent storage agent = getAgent(_state, _agentVault);
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
        Agent storage agent = getAgent(_state, _agentVault);
        agent.redeemingAMG = SafeMath64.sub64(agent.redeemingAMG, _valueAMG, "not enough redeeming");
    }
    
    function announceWithdrawal(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _valueNATWei
    )
        external
    {
        Agent storage agent = getAgent(_state, _agentVault);
        requireAgentVaultOwner(_agentVault);
        require(agent.status == AgentStatus.NORMAL, "withdrawal ann: invalid status");
        if (_valueNATWei > agent.withdrawalAnnouncedNATWei) {
            AgentCollateral.CollateralData memory collateralData = 
                AgentCollateral.agentClass1CollateralData(_state, agent, _agentVault);
            // announcement increased - must check there is enough free collateral and then lock it
            // in this case the wait to withdrawal restarts from this moment
            uint256 increase = _valueNATWei - agent.withdrawalAnnouncedNATWei;
            require(increase <= collateralData.freeCollateralWei(_state, agent),
                "withdrawal: value too high");
            agent.withdrawalAnnouncedAt = SafeCast.toUint64(block.timestamp);
        } else {
            // announcement decreased or cancelled
            // if value is 0, we cancel announcement completely (i.e. set announcement time to 0)
            // otherwise, for decreasing announcement, we can safely leave announcement time unchanged
            if (_valueNATWei == 0) {
                agent.withdrawalAnnouncedAt = 0;
            }
        }
        agent.withdrawalAnnouncedNATWei = SafeCast.toUint128(_valueNATWei);
        emit AMEvents.CollateralWithdrawalAnnounced(_agentVault, _valueNATWei, agent.withdrawalAnnouncedAt);
    }

    function increaseDust(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _dustIncreaseAMG
    )
        internal
    {
        Agent storage agent = getAgent(_state, _agentVault);
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
        Agent storage agent = getAgent(_state, _agentVault);
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
        Agent storage agent = getAgent(_state, _agentVault);
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
        Agent storage agent = getAgent(_state, _agentVault);
        require (_token != agent.collateralPool.poolToken(), "cannot withdraw pool tokens");
        // we only care about agent's collateral class1 tokens and pool tokens
        if (_token != _state.getClass1Token(agent)) return;
        require(agent.status == AgentStatus.NORMAL, "withdrawal: invalid status");
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
        Agent storage _agent,
        address _agentVault,
        address _receiver,
        uint256 _amountWei
    )
        internal
        returns (uint256 _amountPaid)
    {
        CollateralToken.Token storage collateral = _state.getClass1Collateral(_agent);
        // don't want the calling method to fail due to too small balance for payout
        _amountPaid = Math.min(_amountWei, collateral.token.balanceOf(_agentVault));
        IAgentVault vault = IAgentVault(_agentVault);
        vault.payout(collateral.token, _receiver, _amountPaid);
    }

    function payoutFromPool(
        AssetManagerState.State storage _state, 
        Agent storage _agent,
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
        returns (Agent storage _agent) 
    {
        _agent = _state.agents[_agentVault];
        require(_agent.agentType != AgentType.NONE, "invalid agent vault address");
    }

    function getAgentNoCheck(
        AssetManagerState.State storage _state, 
        address _agentVault
    ) 
        internal view 
        returns (Agent storage _agent) 
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
        Agent storage agent = getAgent(_state, _agentVault);
        return _token == _state.getWNat() || _token == _state.getClass1Token(agent);
    }
}
