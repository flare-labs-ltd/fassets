// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "./Conversion.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./AssetManagerState.sol";


library CollateralReservations {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using Agents for Agents.Agent;
    
    struct CollateralReservation {
        bytes32 minterUnderlyingAddress;
        uint128 underlyingValueUBA;
        uint64 firstUnderlyingBlock;
        uint64 underlyingBlockChallengeTimestamp;
        uint128 underlyingFeeUBA;
        address agentVault;
        uint64 valueAMG;
        address minter;
        bool underlyingBlockVerified;
    }
    
    function reserveCollateral(
        AssetManagerState.State storage _state, 
        address _minter,
        bytes32 _minterUnderlyingAddress,
        address _agentVault,
        uint256 _fullAgentCollateral,
        uint256 _amgToNATWeiPrice,
        uint64 _lots,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        // TODO: check fee paid?
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.availableAgentsPos != 0, "agent not in mint queue");
        require(_lots > 0, "cannot mint 0 blocks");
        require(!Agents.isAgentInLiquidation(_state, _agentVault), "agent in liquidation");
        require(agent.freeCollateralLots(_state.settings, _fullAgentCollateral, _amgToNATWeiPrice) >= _lots,
            "not enough free collateral");
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(_currentUnderlyingBlock, _state.settings.underlyingBlocksForPayment);
        uint64 valueAMG = SafeMath64.mul64(_lots, _state.settings.lotSizeAMG);
        agent.reservedAMG = SafeMath64.add64(agent.reservedAMG, valueAMG);
        uint256 underlyingValueUBA = Conversion.convertAmgToUBA(_state.settings, valueAMG);
        uint256 underlyingFeeUBA = underlyingValueUBA.mulBips(agent.feeBIPS);
        uint64 crtId = ++_state.newCrtId;   // pre-increment - id can never be 0
        _state.crts[crtId] = CollateralReservation({
            minterUnderlyingAddress: _minterUnderlyingAddress,
            underlyingValueUBA: SafeCast.toUint128(underlyingValueUBA),
            underlyingFeeUBA: SafeCast.toUint128(underlyingFeeUBA),
            agentVault: _agentVault,
            valueAMG: valueAMG,
            minter: _minter,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            underlyingBlockChallengeTimestamp: 0,   // not challenged
            underlyingBlockVerified: false
        });
        emit AMEvents.CollateralReserved(_agentVault, _minter, crtId, _lots, 
            underlyingValueUBA, underlyingFeeUBA, lastUnderlyingBlock,
            mintingPaymentReference(crtId));
    }
    
    function reservationTimeout(
        AssetManagerState.State storage _state, 
        uint64 _crtId,
        uint64 _currentUnderlyingBlock  // must be proved
    )
        internal
    {
        CollateralReservations.CollateralReservation storage crt = getCollateralReservation(_state, _crtId);
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(crt.firstUnderlyingBlock, _state.settings.underlyingBlocksForPayment);
        require(_currentUnderlyingBlock >= lastUnderlyingBlock, "timeout too early");
        Agents.requireOwnerAgent(crt.agentVault);
        emit AMEvents.CollateralReservationTimeout(crt.agentVault, crt.minter, _crtId);
        _cancelCollateralReservation(_state, crt, _crtId);
    }
    
    function releaseCollateralReservation(
        AssetManagerState.State storage _state,
        CollateralReservations.CollateralReservation storage crt,
        uint64 _crtId
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, crt.agentVault);
        agent.reservedAMG = SafeMath64.sub64(agent.reservedAMG, crt.valueAMG, "invalid reservation");
        delete _state.crts[_crtId];
    }

    function challengeReservationUnderlyingBlock(
        AssetManagerState.State storage _state, 
        uint64 _crtId
    )
        internal
    {
        // TODO: should only agent be allowed to do this?
        CollateralReservations.CollateralReservation storage crt = getCollateralReservation(_state, _crtId);
        require(!crt.underlyingBlockVerified, "underlying block verified");
        crt.underlyingBlockChallengeTimestamp = SafeCast.toUint64(block.timestamp);
        emit AMEvents.CRUnderlyingBlockChallenged(crt.minter, _crtId);
    }
    
    function verifyUnderlyingBlock(
        AssetManagerState.State storage _state, 
        uint64 _crtId,
        uint256 _provedUnderlyingBlock    // must be proved
    )
        internal
    {
        CollateralReservations.CollateralReservation storage crt = getCollateralReservation(_state, _crtId);
        require(_provedUnderlyingBlock >= crt.firstUnderlyingBlock, "proved block too low");
        crt.underlyingBlockVerified = true;
    }

    function underlyingBlockChallengeTimeout(
        AssetManagerState.State storage _state, 
        uint64 _crtId
    )
        internal
    {
        CollateralReservations.CollateralReservation storage crt = getCollateralReservation(_state, _crtId);
        require(!crt.underlyingBlockVerified, "underlying block verified");
        uint256 lastTimestamp = uint256(crt.underlyingBlockChallengeTimestamp)
            .add(_state.settings.minSecondsForBlockChallengeResponse);
        require(block.timestamp > lastTimestamp, "not late for block proof");
        Agents.requireOwnerAgent(crt.agentVault);
        emit AMEvents.CRUnderlyingBlockChallengeTimeout(crt.agentVault, crt.minter, _crtId);
        _cancelCollateralReservation(_state, crt, _crtId);
    }

    function getCollateralReservation(
        AssetManagerState.State storage _state, 
        uint64 _crtId
    ) 
        internal view
        returns (CollateralReservation storage) 
    {
        require(_crtId > 0 && _state.crts[_crtId].valueAMG != 0, "invalid crt id");
        return _state.crts[_crtId];
    }
    
    function mintingPaymentReference(uint256 _crtId) 
        internal pure
        returns (bytes32)
    {
        // TODO: should add some larger constant or hash with something to differentiate 
        // from other possible reference types?
        return bytes32(1 + _crtId);
    }
    
    function _cancelCollateralReservation(
        AssetManagerState.State storage _state,
        CollateralReservations.CollateralReservation storage crt,
        uint64 _crtId
    )
        private
    {
        // TODO: pay fee to agent
        releaseCollateralReservation(_state, crt, _crtId);  // crt can't be used after this        
    }
}
