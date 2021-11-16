// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/lib/SafePctX.sol";
import "./AssetManagerState.sol";


library Agents {
    using SafeMath for uint256;
    using SafePctX for uint256;
    
    enum AgentStatus {
        EMPTY,
        NORMAL,
        LIQUIDATION
    }

    struct UnderlyingFunds {
        // The amount of underlying funds that may be withdrawn by the agent
        // (fees, self-close and, amount released by liquidation).
        // May become negative (due to high underlying gas costs), in which case topup is required.
        int256 freeBalanceUBA;
        
        // The number of lots of fassets backed by this this underlying address
        // (there may be multiple underlying addresses for an agent).
        uint64 mintedLots;
        
        // When freeBalanceUBA becomes negative, agent has until this block to perform topup,
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
        
        // Number of lots locked by collateral reservation.
        uint64 reservedLots;
        
        // Number of lots of collateral for minted fassets.
        uint64 mintedLots;
        
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
        uint64 oldReservedLots;
        uint32 oldMintingCollateralRatioBIPS;
        uint8 availabilityEnterCountMod2;
        
        // Current status of the agent (changes for liquidation).
        AgentStatus status;
    }
    
    event AgentFreeCollateralChanged(
        address vaultAddress, 
        uint256 freeCollateral);
        
    function createAgent(
        AssetManagerState.State storage _state, 
        address _agentVault
    ) 
        internal 
    {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.status == AgentStatus.EMPTY, "agent already exists");
        agent.status = AgentStatus.NORMAL;
        agent.minCollateralRatioBIPS = _state.settings.initialMinCollateralRatioBIPS;
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
