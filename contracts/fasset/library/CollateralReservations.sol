// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeMathX.sol";
import "../../utils/lib/SafePctX.sol";
import "./AssetManagerState.sol";
import "./AgentCollateral.sol";


library CollateralReservations {
    using SafeMath for uint256;
    using SafePctX for uint256;
    
    event CollateralReserved(
        address indexed minter,
        uint256 collateralReservationId,
        bytes32 underlyingAddress,
        uint256 underlyingValueUBA, 
        uint256 underlyingFeeUBA,
        uint256 lastUnderlyingBlock);
        
    function claimMinterUnderlyingAddress(
        AssetManagerState.State storage _state, 
        address _minter, 
        bytes32 _address
    ) 
        internal 
    {
        if (_state.underlyingAddressOwner[_address] == address(0)) {
            _state.underlyingAddressOwner[_address] = _minter;
        } else if (_state.underlyingAddressOwner[_address] != _minter) {
            revert("address belongs to other minter");
        }
    }
    
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
        AssetManagerState.Agent storage agent = _state.agents[_agentVault];
        require(agent.availableAgentsPos != 0, "agent not in mint queue");
        require(_lots > 0, "cannot mint 0 blocks");
        require(AgentCollateral.freeCollateralLots(agent, _fullAgentCollateral, _lotSizeWei) >= _lots,
            "not enough free collateral");
        claimMinterUnderlyingAddress(_state, _minter, _minterUnderlyingAddress);
        uint64 lastUnderlyingBlock = SafeMath64.add64(_currentUnderlyingBlock, _state.underlyingBlocksForPayment);
        agent.reservedLots = SafeMath64.add64(agent.reservedLots, _lots);
        uint256 underlyingValueUBA = _state.lotSizeUBA.mul(_lots);
        uint256 underlyingFeeUBA = underlyingValueUBA.mulBips(agent.feeBIPS);
        uint64 crtId = ++_state.newCrtId;   // pre-increment - id can never be 0
        _state.crts[crtId] = AssetManagerState.CollateralReservation({
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
        emit AgentCollateral.AgentFreeCollateralChanged(_agentVault, 
            AgentCollateral.freeCollateralWei(agent, _fullAgentCollateral, _lotSizeWei));
    }

    function getCollateralReservation(
        AssetManagerState.State storage _state, 
        uint64 _crtId
    ) 
        internal view
        returns (AssetManagerState.CollateralReservation storage) 
    {
        require(_crtId > 0 && _state.crts[_crtId].lots != 0, "invalid crt id");
        return _state.crts[_crtId];
    }
}
