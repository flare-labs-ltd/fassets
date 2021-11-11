// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "flare-smart-contracts/contracts/utils/implementation/SafePct.sol";
import "../../utils/lib/SafeMath64.sol";
import "./AssetManagerState.sol";


library UnderlyingTopup {
    using SafeMath for uint256;
    using SafePct for uint256;
    
    event TopupRequired(
        address indexed vaultAddress,
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint64 firstUnderlyingBlock,
        uint64 lastUnderlyingBlock,
        uint64 requestId);

    function requireUnderlyingTopup(
        AssetManagerState.State storage _state,
        address _agentVault,
        bytes32 _agentUnderlyingAddress,
        uint256 _valueUBA,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        AssetManagerState.Agent storage agent = _state.agents[_agentVault];
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(_currentUnderlyingBlock, _state.underlyingBlocksForTopup);
        agent.requiredUnderlyingTopups.push(AssetManagerState.TopupRequirement({
            underlyingAddress: _agentUnderlyingAddress,
            valueUBA: _valueUBA,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock
        }));
        agent.allowedUnderlyingPayments[_agentUnderlyingAddress] = 0;
        emit TopupRequired(_agentVault, _agentUnderlyingAddress, _valueUBA, 
            _currentUnderlyingBlock, lastUnderlyingBlock, 
            SafeMath64.toUint64(agent.requiredUnderlyingTopups.length));
    }
}
