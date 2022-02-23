// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../interface/IAgentVault.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "./AMEvents.sol";
import "./Conversion.sol";
import "./RedemptionQueue.sol";
import "./UnderlyingAddressOwnership.sol";
import "./AssetManagerState.sol";
import "./AgentCollateral.sol";


library Agents {
    using SafeBips for uint256;
    using SafePct for uint256;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    using RedemptionQueue for RedemptionQueue.State;
    using AgentCollateral for AgentCollateral.Data;
    
    enum AgentType {
        NONE,
        AGENT_100,
        AGENT_0
    }
    
    enum AgentStatus {
        NORMAL,
        LIQUIDATION, // CCB, liquidation due to CR or topup
        FULL_LIQUIDATION // illegal payment liquidation
    }

    enum LiquidationPhase {
        CCB,
        PRICE_PREMIUM,
        COLLATERAL_PREMIUM
    }
    
    struct LiquidationState {
        uint64 liquidationStartedAt;
        LiquidationPhase initialLiquidationPhase; // at the time when liquidation started
        uint16 initialPremiumFactorBIPS; // at the time when liquidation started
    }

    struct Agent {
        // Current address for underlying agent's collateral.
        // Agent can change this address anytime and it affects future mintings.
        bytes underlyingAddressString;
        
        // `underlyingAddressString` is only used for sending the minter a correct payment address;
        // for matching payment addresses we always use `underlyingAddressHash = keccak256(underlyingAddressString)`
        bytes32 underlyingAddressHash;
        
        // For agents to withdraw NAT collateral, they must first announce it and then wait 
        // withdrawalAnnouncementSeconds. 
        // The announced amount cannt be used as collateral for minting during that time.
        // This makes sure that agents cannot just remove all collateral if they are challenged.
        uint128 withdrawalAnnouncedNATWei;
        
        // The time when withdrawal was announced.
        uint64 withdrawalAnnouncedAt;
        
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
        
        // Position of this agent in the list of agents available for minting.
        // Value is actually `list index + 1`, so that 0 means 'not in list'.
        uint64 availableAgentsPos;
        
        // Minting fee in BIPS (collected in underlying currency).
        uint16 feeBIPS;
        
        // Collateral ratio at which we calculate locked collateral and collateral available for minting.
        // Agent may set own value for minting collateral ratio when entering the available agent list,
        // but it must always be greater than minimum collateral ratio.
        uint32 agentMinCollateralRatioBIPS;
        
        // Current status of the agent (changes for liquidation).
        AgentType agentType;
        AgentStatus status;
        LiquidationState liquidationState;

        // The amount of underlying funds that may be withdrawn by the agent
        // (fees, self-close and, amount released by liquidation).
        // May become negative (due to high underlying gas costs), in which case topup is required.
        int128 freeUnderlyingBalanceUBA;
        
        // The number of successful payment challenges - if it is >= 1, agent is already being liquidated.
        // Therefore, for >= 1, new challenges are not accepted but old ones can still be proved.
        // The reward for later challenges diminishes - it is divided by 2^successfulPaymentChallenges, so that total 
        // is always less than twice the challenge reward from settings.
        uint32 successfulPaymentChallenges;
        
        // There can be only one announced payment per agent active at any time.
        // This variable holds the id, or 0 if there is no announced payment going on.
        uint64 ongoingAnnouncedPaymentId;
    }
    
    function createAgent(
        AssetManagerState.State storage _state, 
        AgentType _agentType,
        address _agentVault,
        bytes memory _underlyingAddressString
    ) 
        external 
    {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.agentType == AgentType.NONE, "agent already exists");
        require(_agentType == AgentType.AGENT_100, "agent type not supported");
        require(_underlyingAddressString.length != 0, "empty underlying address");
        agent.agentType = _agentType;
        agent.status = AgentStatus.NORMAL;
        // initially, agentMinCollateralRatioBIPS is the same as global min collateral ratio
        // this setting is ok for self-minting, but not for public minting since it quickly leads to liquidation
        // it can be changed with setAgentMinCollateralRatioBIPS or when agent becomes available
        agent.agentMinCollateralRatioBIPS = _state.settings.initialMinCollateralRatioBIPS;
        // claim the address to make sure no other agent is using it
        // for chains where this is required, also checks that address was proved to be EOA
        bytes32 underlyingAddressHash = keccak256(_underlyingAddressString);
        _state.underlyingAddressOwnership.claim(msg.sender, underlyingAddressHash, 
            _state.settings.requireEOAAddressProof);
        agent.underlyingAddressString = _underlyingAddressString;
        agent.underlyingAddressHash = underlyingAddressHash;
        emit AMEvents.AgentCreated(msg.sender, uint8(_agentType), _agentVault, _underlyingAddressString);
    }
    
    function destroyAgent(
        AssetManagerState.State storage _state, 
        address _agentVault
    )
        external
    {
        Agent storage agent = getAgent(_state, _agentVault);
        require(agent.mintedAMG == 0 && agent.reservedAMG == 0 && agent.redeemingAMG == 0, "agent still active");
        require(agent.availableAgentsPos == 0, "agent still available");
        // check that all collateral has been announced for withdrawal
        uint256 fullCollateral = IAgentVault(_agentVault).fullCollateral();
        if (fullCollateral > 0) {
            withdrawalExecuted(_state, _agentVault, fullCollateral);
        }
        // delete agent data
        delete _state.agents[_agentVault];
        emit AMEvents.AgentDestroyed(_agentVault);
    }
    
    function setAgentMinCollateralRatioBIPS(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _agentMinCollateralRatioBIPS
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(_agentMinCollateralRatioBIPS >= _state.settings.initialMinCollateralRatioBIPS,
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
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, _agentVault);
        if (_valueNATWei > agent.withdrawalAnnouncedNATWei) {
            // announcement increased - must check there is enough free collateral and then lock it
            // in this case the wait to withdrawal restarts from this moment
            uint256 increase = _valueNATWei - agent.withdrawalAnnouncedNATWei;
            require(increase <= collateralData.freeCollateralWei(agent, _state.settings),
                "withdrawal: value too high");
            agent.withdrawalAnnouncedAt = SafeCast.toUint64(block.timestamp);
        } else {
            // announcement decreased or canceled - might be needed to get agent out of CCB
            // if value is 0, we cancel announcement completely (i.e. set announcement time to 0)
            // otherwise, for decreasing announcement, we can safely leave announcement time unchanged
            if (_valueNATWei == 0) {
                agent.withdrawalAnnouncedAt = 0;
            }
        }
        agent.withdrawalAnnouncedNATWei = SafeCast.toUint128(_valueNATWei);
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
    
    function convertDustToTickets(
        AssetManagerState.State storage _state,
        address _agentVault
    )
        external
    {
        Agent storage agent = getAgent(_state, _agentVault);
        // if dust is more than 1 lot, create a new redemption ticket
        if (agent.dustAMG >= _state.settings.lotSizeAMG) {
            uint64 remainingDustAMG = agent.dustAMG % _state.settings.lotSizeAMG;
            _state.redemptionQueue.createRedemptionTicket(_agentVault, agent.dustAMG - remainingDustAMG);
            agent.dustAMG = remainingDustAMG;
        }
    }
    
    function withdrawalExecuted(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _valueNATWei
    )
        public
    {
        Agent storage agent = getAgent(_state, _agentVault);
        require(_valueNATWei <= agent.withdrawalAnnouncedNATWei,
            "withdrawal: more than announced");
        require(agent.withdrawalAnnouncedAt != 0 &&
            block.timestamp <= agent.withdrawalAnnouncedAt + _state.settings.withdrawalWaitMinSeconds,
            "withdrawal: not announced");
        agent.withdrawalAnnouncedNATWei -= uint128(_valueNATWei);    // guarded by above require
        // could reset agent.withdrawalAnnouncedAt if agent.withdrawalAnnouncedNATWei == 0, 
        // but it's not needed, since no withdrawal can be made anyway
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
    
    function isAgentInLiquidation(
        AssetManagerState.State storage _state, 
        address _agentVault
    )
        internal view
        returns (bool)
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        return agent.liquidationState.liquidationStartedAt > 0;
    }

    function vaultOwner(address _agentVault) internal view returns (address) {
        return IAgentVault(_agentVault).owner();
    }
    
    function requireAgentVaultOwner(address _agentVault) internal view {
        address owner = IAgentVault(_agentVault).owner();
        require(msg.sender == owner, "only agent vault owner");
    }
}
