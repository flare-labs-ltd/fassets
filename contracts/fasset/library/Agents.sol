// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/lib/SafeBips.sol";
import "./UnderlyingAddressOwnership.sol";
import "./AssetManagerState.sol";
import "./Conversion.sol";


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
        int128 freeBalanceUBA;
        
        // The amount of fassets backed by this this underlying address
        // (there may be multiple underlying addresses for an agent).
        uint64 mintedAMG;
        
        // When freeBalanceUBA becomes negative, agent has until this block to perform topup,
        // otherwise liquidation can be triggered by a challenger.
        uint64 lastUnderlyingBlockForTopup;
        
        // When lot size changes, there may be some leftover after redemtpion that doesn't fit
        // a whole lot size. It is added to dustAMG and can be recovered via self-close.
        uint64 dustAMG;
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
        
        // Amount of collateral locked by collateral reservation.
        uint64 reservedAMG;
        
        // Amount of collateral backing minted fassets.
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
    
    event AddressDustChanged(
        address indexed agentVault,
        bytes32 underlyingAddress,
        uint256 dustUBA);
        
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
        // if the old underlying address isn't backing any minted assets, we release it now
        // otherwise it will be released when the last lot is redeemed or liquidated
        if (oldUnderlyingAddress != 0) {
            _deleteUnderlyingAddressIfUnused(agent, oldUnderlyingAddress);
        }
    }
    
    function allocateMintedAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        bytes32 _underlyingAddress,
        uint64 _valueAMG
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        agent.mintedAMG = SafeMath64.add64(agent.mintedAMG, _valueAMG);
        Agents.UnderlyingFunds storage uaf = agent.perAddressFunds[_underlyingAddress];
        uaf.mintedAMG = SafeMath64.add64(uaf.mintedAMG, _valueAMG);
    }

    function releaseMintedAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        bytes32 _underlyingAddress,
        uint64 _valueAMG
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        agent.mintedAMG = SafeMath64.sub64(agent.mintedAMG, _valueAMG, "ERROR: not enough minted");
        Agents.UnderlyingFunds storage uaf = agent.perAddressFunds[_underlyingAddress];
        uaf.mintedAMG = SafeMath64.sub64(uaf.mintedAMG, _valueAMG, "ERROR: underlying minted");
        _deleteUnderlyingAddressIfUnused(agent, _underlyingAddress);
    }
    
    function announceWithdrawal(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _valueNATWei,
        uint256 _fullCollateral, 
        uint256 _amgToNATWeiPrice
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        if (_valueNATWei > agent.withdrawalAnnouncedNATWei) {
            // announcement increased - must check there is enough free collateral and then lock it
            // in this case the wait to withdrawal restarts from this moment
            uint256 increase = agent.withdrawalAnnouncedNATWei - _valueNATWei;
            require(increase < freeCollateralWei(agent, _fullCollateral, _amgToNATWeiPrice),
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
        bytes32 _underlyingAddress,
        uint64 _dustIncreaseAMG
    )
        internal
    {
        Agents.UnderlyingFunds storage uaf = getUnderlyingFunds(_state, _agentVault, _underlyingAddress);
        uaf.dustAMG = SafeMath64.add64(uaf.dustAMG, _dustIncreaseAMG);
        emit AddressDustChanged(_agentVault, _underlyingAddress, uaf.dustAMG);
    }
    
    function withdrawalExecuted(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _valueNATWei
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.withdrawalAnnouncedAt != 0 &&
            block.timestamp <= agent.withdrawalAnnouncedAt + _state.settings.withdrawalWaitMinSeconds,
            "withdrawal: not announced");
        require(_valueNATWei <= agent.withdrawalAnnouncedNATWei,
            "withdrawal: more than announced");
        agent.withdrawalAnnouncedAt = 0;
        agent.withdrawalAnnouncedNATWei = 0;
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
    
    function getUnderlyingFunds(
        AssetManagerState.State storage _state, 
        address _agentVault,
        bytes32 _underlyingAddress
    )
        internal view
        returns (Agents.UnderlyingFunds storage)
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        return agent.perAddressFunds[_underlyingAddress];
    }

    function freeCollateralLots(
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings,
        uint256 _fullCollateral, 
        uint256 _amgToNATWeiPrice
    )
        internal view 
        returns (uint256) 
    {
        uint256 freeCollateral = freeCollateralWei(_agent, _fullCollateral, _amgToNATWeiPrice);
        uint256 lotCollateral = mintingLotCollateralWei(_agent, _settings, _amgToNATWeiPrice);
        return freeCollateral.div(lotCollateral);
    }

    function freeCollateralWei(
        Agents.Agent storage _agent, 
        uint256 _fullCollateral, 
        uint256 _amgToNATWeiPrice
    )
        internal view 
        returns (uint256) 
    {
        uint256 lockedCollateral = lockedCollateralWei(_agent, _amgToNATWeiPrice);
        (, uint256 freeCollateral) = _fullCollateral.trySub(lockedCollateral);
        return freeCollateral;
    }
    
    function lockedCollateralWei(
        Agents.Agent storage _agent, 
        uint256 _amgToNATWeiPrice
    )
        internal view 
        returns (uint256) 
    {
        // reservedCollateral = _agent.reservedAMG * 
        // reserved collateral is calculated at minting ratio
        uint256 reservedCollateral = Conversion.convertAmgToNATWei(_agent.reservedAMG, _amgToNATWeiPrice)
            .mulBips(_agent.mintingCollateralRatioBIPS);
        // old reserved collateral (from before agent exited and re-entered minting queue), at old minting ratio
        uint256 oldReservedCollateral = Conversion.convertAmgToNATWei(_agent.oldReservedAMG, _amgToNATWeiPrice)
            .mulBips(_agent.oldMintingCollateralRatioBIPS);
        // minted collateral is calculated at minimal ratio
        uint256 mintedCollateral = Conversion.convertAmgToNATWei(_agent.mintedAMG, _amgToNATWeiPrice)
            .mulBips(_agent.minCollateralRatioBIPS);
        return reservedCollateral
            .add(oldReservedCollateral)
            .add(mintedCollateral)
            .add(_agent.withdrawalAnnouncedNATWei);
    }
    
    function mintingLotCollateralWei(
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings,
        uint256 _amgToNATWeiPrice
    ) 
        internal view 
        returns (uint256) 
    {
        return Conversion.convertAmgToNATWei(_settings.lotSizeAMG, _amgToNATWeiPrice)
            .mulBips(_agent.mintingCollateralRatioBIPS);
    }

    function _deleteUnderlyingAddressIfUnused(
        Agent storage _agent,
        bytes32 _underlyingAddress
    )
        private
    {
        // if the underlying address isn't backing any f-assets any more and it is not used for new mintings,
        // then we can safely release it - no need for outpayment tracking
        Agents.UnderlyingFunds storage uaf = _agent.perAddressFunds[_underlyingAddress];
        if (uaf.mintedAMG == 0 && _underlyingAddress != _agent.underlyingAddress) {
            delete _agent.perAddressFunds[_underlyingAddress];
        }
    }
}
