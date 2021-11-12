// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/lib/SafeMath64.sol";
import "./UnderlyingTopup.sol";
import "./AssetManagerState.sol";


library Agents {
    
    enum AgentStatus { 
        EMPTY,
        NORMAL,
        LIQUIDATION
    }

    struct Agent {
        bytes32 underlyingAddress;
        // agent is allowed to withdraw fee or liquidated underlying amount (including gas)
        mapping(bytes32 => uint256) allowedUnderlyingPayments;      // underlyingAddress -> allowedUBA
        UnderlyingTopup.TopupRequirement[] requiredUnderlyingTopups;
        uint64 reservedLots;
        uint64 mintedLots;
        uint32 minCollateralRatioBIPS;
        uint64 availableAgentsPos;    // (index in mint queue)+1; 0 = not in queue
        uint16 feeBIPS;
        uint32 mintingCollateralRatioBIPS;
        // When an agent exits and re-enters availability list, mintingCollateralRatio changes
        // so we have to acocunt for that when calculating total reserved collateral.
        // We simplify by only allowing one change before the old CRs are executed or cleared.
        // Therefore we store relevant old values here and match old/new by 0/1 flag 
        // named `availabilityEnterCountMod2` here and in CR.
        uint64 oldReservedLots;
        uint32 oldMintingCollateralRatioBIPS;
        uint8 availabilityEnterCountMod2;
        AgentStatus status;
    }
    
    function initAgent(
        AssetManagerState.State storage _state, 
        address _agentVault
    ) 
        internal 
    {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.status == AgentStatus.EMPTY, "agent already exists");
        agent.status = AgentStatus.NORMAL;
        agent.minCollateralRatioBIPS = _state.initialMinCollateralRatioBIPS;
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
}
