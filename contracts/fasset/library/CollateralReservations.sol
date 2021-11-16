// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeMathX.sol";
import "../../utils/lib/SafePctX.sol";
import "./Agents.sol";
import "./UnderlyingAddressOwnership.sol";
import "./AssetManagerState.sol";


library CollateralReservations {
    using SafeMath for uint256;
    using SafePctX for uint256;
    using Agents for Agents.Agent;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    
    struct CollateralReservation {
        bytes32 agentUnderlyingAddress;
        bytes32 minterUnderlyingAddress;
        uint192 underlyingValueUBA;
        uint64 firstUnderlyingBlock;
        uint192 underlyingFeeUBA;
        uint64 lastUnderlyingBlock;
        address agentVault;
        uint64 lots;
        address minter;
        uint8 availabilityEnterCountMod2;
    }

    event CollateralReserved(
        address indexed minter,
        uint256 collateralReservationId,
        bytes32 underlyingAddress,
        uint256 underlyingValueUBA, 
        uint256 underlyingFeeUBA,
        uint256 lastUnderlyingBlock);
        
    function reserveCollateral(
        AssetManagerState.State storage _state, 
        address _minter,
        bytes32 _minterUnderlyingAddress,
        address _agentVault,
        uint256 _fullAgentCollateral,
        uint256 _lotSizeWei,
        uint64 _lots,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        require(agent.availableAgentsPos != 0, "agent not in mint queue");
        require(_lots > 0, "cannot mint 0 blocks");
        require(agent.freeCollateralLots(_fullAgentCollateral, _lotSizeWei) >= _lots, "not enough free collateral");
        _state.underlyingAddressOwnership.claim(_minter, _minterUnderlyingAddress);
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(_currentUnderlyingBlock, _state.settings.underlyingBlocksForPayment);
        agent.reservedLots = SafeMath64.add64(agent.reservedLots, _lots);
        uint256 underlyingValueUBA = _state.settings.lotSizeUBA.mul(_lots);
        uint256 underlyingFeeUBA = underlyingValueUBA.mulBips(agent.feeBIPS);
        uint64 crtId = ++_state.newCrtId;   // pre-increment - id can never be 0
        _state.crts[crtId] = CollateralReservation({
            agentUnderlyingAddress: agent.underlyingAddress,
            minterUnderlyingAddress: _minterUnderlyingAddress,
            underlyingValueUBA: SafeMathX.toUint192(underlyingValueUBA),
            underlyingFeeUBA: SafeMathX.toUint192(underlyingFeeUBA),
            agentVault: _agentVault,
            lots: SafeMath64.toUint64(_lots),
            minter: _minter,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock,
            availabilityEnterCountMod2: agent.availabilityEnterCountMod2
        });
        emit CollateralReserved(_minter, crtId, 
            agent.underlyingAddress, underlyingValueUBA, underlyingFeeUBA, lastUnderlyingBlock);
        emit Agents.AgentFreeCollateralChanged(_agentVault,
            agent.freeCollateralWei(_fullAgentCollateral, _lotSizeWei));
    }

    function getCollateralReservation(
        AssetManagerState.State storage _state, 
        uint64 _crtId
    ) 
        internal view
        returns (CollateralReservation storage) 
    {
        require(_crtId > 0 && _state.crts[_crtId].lots != 0, "invalid crt id");
        return _state.crts[_crtId];
    }
}
