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

    struct UnderlyingAddressFunds {
        int256 freeBalanceUBA;
        uint64 mintedLots;
        uint64 lastUnderlyingBlockForTopup;
    }
    
    struct Agent {
        bytes32 underlyingAddress;
        
        // Agent is allowed to withdraw fee or liquidated underlying amount.
        // Allowed payments must cover withdrawal value when announced
        // after withdrawal, underlying gas must also be covered, otherwise topup request is triggered.
        // Mapping underlyingAddress => UnderlyingAddressFunds
        mapping(bytes32 => UnderlyingAddressFunds) perAddressFunds;
        
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
