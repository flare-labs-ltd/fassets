// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/lib/SafeBips.sol";
import "./UnderlyingAddressOwnership.sol";
import "./AssetManagerState.sol";


library Agents {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    
    enum AgentType {
        NONE,
        AGENT_100,
        AGENT_0,
        SELF_MINTING
    }
    
    enum AgentStatus {
        NORMAL,
        LIQUIDATION
    }

    struct UnderlyingFunds {
        // The amount of underlying funds that may be withdrawn by the agent
        // (fees, self-close and, amount released by liquidation).
        // May become negative (due to high underlying gas costs), in which case topup is required.
        int64 freeBalanceAMG;
        
        // The amount of fassets backed by this this underlying address
        // (there may be multiple underlying addresses for an agent).
        uint64 mintedAMG;
        
        // When freeBalanceAMG becomes negative, agent has until this block to perform topup,
        // otherwise liquidation can be triggered by a challenger.
        uint64 lastUnderlyingBlockForTopup;
    }

    struct Agent {
        // Current address for underlying agent's collateral.
        // Agent can change this address anytime and it affects future mintings.
        bytes32 underlyingAddress;
        
        // Agent is allowed to withdraw fee or liquidated underlying amount.
        // Allowed payments must cover withdrawal value when announced
        // after withdrawal, underlying gas must also be covered, otherwise topup request is triggered.
        // Type: mapping underlyingAddress => Agents.UnderlyingFunds
        mapping(bytes32 => UnderlyingFunds) perAddressFunds;
        
        // For agents to withdraw NAT collateral, they must first announce it and then wait 
        // withdrawalAnnouncementSeconds. 
        // The announced amount cannt be used as collateral for minting during that time.
        // This makes sure that agents cannot just remove all collateral if they are challenged.
        uint128 withdrawalAnnouncedNATWei;
        
        // The time when withdrawal was announced.
        uint64 withdrawalAnnouncedAt;
        
        // Number of lots locked by collateral reservation.
        uint64 reservedAMG;
        
        // Number of lots of collateral for minted fassets.
        uint64 mintedAMG;
        
        // Minimum native collateral ratio required for this agent. Changes during the liquidation.
        uint32 minCollateralRatioBIPS;
        
        // Position of this agent in the list of agents available for minting.
        // Value is actually `list index + 1`, so that 0 means 'not in list'.
        uint64 availableAgentsPos;
        
        // Minting fee in BIPS (collected in underlying currency).
        uint16 feeBIPS;
        
        // Minimum collateral ratio at which minting can occur.
        // Agent may set own value for minting collateral ratio when entering the available agent list,
        // but it must always be greater than minimum collateral ratio.
        uint32 mintingCollateralRatioBIPS;
        
        // When an agent exits and re-enters availability list, mintingCollateralRatio changes
        // so we have to acocunt for that when calculating total reserved collateral.
        // We simplify by only allowing one change before the old CRs are executed or cleared.
        // Therefore we store relevant old values here and match old/new by 0/1 flag 
        // named `availabilityEnterCountMod2` here and in CR.
        uint64 oldReservedAMG;
        uint32 oldMintingCollateralRatioBIPS;
        uint8 availabilityEnterCountMod2;
        
        // Current status of the agent (changes for liquidation).
        AgentType agentType;
        AgentStatus status;
    }
    
    function createAgent(
        AssetManagerState.State storage _state, 
        AgentType _agentType,
        address _agentVault,
        bytes32 _initialUnderlyingAddress
    ) 
        internal 
    {
        // TODO: create vault here instead of passing _agentVault?
        Agent storage agent = _state.agents[_agentVault];
        require(agent.agentType == AgentType.NONE, "agent already exists");
        agent.agentType = _agentType;
        agent.status = AgentStatus.NORMAL;
        agent.minCollateralRatioBIPS = _state.settings.initialMinCollateralRatioBIPS;
        setUnderlyingAddress(_state, _agentVault, _initialUnderlyingAddress);
    }
    
    function setUnderlyingAddress(
        AssetManagerState.State storage _state, 
        address _agentVault,
        bytes32 _underlyingAddress
    )
        internal
    {
        require(_underlyingAddress != 0, "zero underlying address");
        Agent storage agent = _state.agents[_agentVault];
        bytes32 oldUnderlyingAddress = agent.underlyingAddress;
        if (oldUnderlyingAddress == _underlyingAddress) return;  // no change
        // claim the address to make sure no other agent is using it
        _state.underlyingAddressOwnership.claim(_agentVault, _underlyingAddress);
        // set new address
        agent.underlyingAddress = _underlyingAddress;
        // if the old underlying address has no minted lots,
        // then we can safely release it - no need for outpayment tracking
        if (oldUnderlyingAddress != 0 && agent.perAddressFunds[oldUnderlyingAddress].mintedLots == 0) {
            delete agent.perAddressFunds[oldUnderlyingAddress];
        }
    }
    
    function allocateMintedLots(
        Agent storage _agent,
        bytes32 _underlyingAddress,
        uint64 _lots
    )
        internal
    {
        _agent.mintedLots = SafeMath64.add64(_agent.mintedLots, _lots);
        Agents.UnderlyingFunds storage uaf = _agent.perAddressFunds[_underlyingAddress];
        uaf.mintedLots = SafeMath64.add64(uaf.mintedLots, _lots);
    }

    function releaseMintedLots(
        Agent storage _agent,
        bytes32 _underlyingAddress,
        uint64 _lots
    )
        internal
    {
        _agent.mintedLots = SafeMath64.sub64(_agent.mintedLots, _lots, "ERROR: not enough minted lots");
        Agents.UnderlyingFunds storage uaf = _agent.perAddressFunds[_underlyingAddress];
        uaf.mintedLots = SafeMath64.sub64(uaf.mintedLots, _lots, "ERROR: underlying minted lots");
        // if the underlying address has no minted lots any more and it is not used for new mintings,
        // then we can safely release it - no need for outpayment tracking
        if (uaf.mintedLots == 0 && _underlyingAddress != _agent.underlyingAddress) {
            delete _agent.perAddressFunds[_underlyingAddress];
        }
    }
    
    function announceWithdrawal(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint128 _valueNATWei
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        require(_valueNATWei < freeCollateralWei(agent, _fullCollateral, _lotSizeWei),
            "withdrawal: value too high");
        agent.withdrawalAnnouncedNATWei = _valueNATWei;
    }
    
    function getAgent(
        AssetManagerState.State storage _state, 
        address _agentVault
    ) 
        internal view 
        returns (Agent storage) 
    {
        return _state.agents[_agentVault];
    }

    function freeCollateralLots(
        Agents.Agent storage _agent, 
        uint256 _fullCollateral, 
        uint256 _lotSizeWei
    )
        internal view 
        returns (uint256) 
    {
        uint256 freeCollateral = freeCollateralWei(_agent, _fullCollateral, _lotSizeWei);
        uint256 lotCollateral = _lotSizeWei.mulBips(_agent.mintingCollateralRatioBIPS);
        return freeCollateral.div(lotCollateral);
    }

    function freeCollateralWei(
        Agents.Agent storage _agent, 
        uint256 _fullCollateral, 
        uint256 _lotSizeWei
    )
        internal view 
        returns (uint256) 
    {
        uint256 lockedCollateral = lockedCollateralWei(_agent, _lotSizeWei);
        (, uint256 freeCollateral) = _fullCollateral.trySub(lockedCollateral);
        return freeCollateral;
    }
    
    function lockedCollateralWei(
        Agents.Agent storage _agent, 
        uint256 _lotSizeWei
    )
        internal view 
        returns (uint256) 
    {
        // reservedCollateral = _agent.reservedAMG * 
        // reserved collateral is calculated at minting ratio
        uint256 reservedCollateral = uint256(_agent.reservedLots).mul(_lotSizeWei)
            .mulBips(_agent.mintingCollateralRatioBIPS);
        // old reserved collateral (from before agent exited and re-entered minting queue), at old minting ratio
        uint256 oldReservedCollateral = uint256(_agent.oldReservedLots).mul(_lotSizeWei)
            .mulBips(_agent.oldMintingCollateralRatioBIPS);
        // minted collateral is calculated at minimal ratio
        uint256 mintedCollateral = uint256(_agent.mintedLots).mul(_lotSizeWei)
            .mulBips(_agent.minCollateralRatioBIPS);
        return reservedCollateral.add(oldReservedCollateral).add(mintedCollateral);
    }
    
    function mintingLotCollateralWei(
        Agents.Agent storage _agent, 
        uint256 _lotSizeWei
    ) 
        internal view 
        returns (uint256) 
    {
        return _lotSizeWei.mulBips(_agent.mintingCollateralRatioBIPS);
    }
}
