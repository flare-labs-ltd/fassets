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
import "../interface/IAgentVault.sol";
import "./AgentCollateral.sol";

library CollateralReservations {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using AgentCollateral for AgentCollateral.Data;
    
    struct CollateralReservation {
        uint128 underlyingValueUBA;
        uint64 firstUnderlyingBlock;
        uint64 underlyingBlockChallengeTimestamp;
        uint128 underlyingFeeUBA;
        address agentVault;
        uint64 valueAMG;
        address minter;
        bool underlyingBlockVerified;
        uint128 reservationFeeNatWei;
    }
    
    function reserveCollateral(
        AssetManagerState.State storage _state, 
        address _minter,
        address _agentVault,
        uint64 _lots,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, _agentVault);
        require(agent.availableAgentsPos != 0, "agent not in mint queue");
        require(_lots > 0, "cannot mint 0 blocks");
        require(!Agents.isAgentInLiquidation(_state, _agentVault), "agent in liquidation");
        require(collateralData.freeCollateralLots(agent, _state.settings) >= _lots, "not enough free collateral");
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(_currentUnderlyingBlock, _state.settings.underlyingBlocksForPayment);
        uint64 valueAMG = SafeMath64.mul64(_lots, _state.settings.lotSizeAMG);
        agent.reservedAMG = SafeMath64.add64(agent.reservedAMG, valueAMG);
        uint256 underlyingValueUBA = Conversion.convertAmgToUBA(_state.settings, valueAMG);
        uint256 underlyingFeeUBA = underlyingValueUBA.mulBips(agent.feeBIPS);
        uint256 valueNATWei = Conversion.convertAmgToNATWei(valueAMG, collateralData.amgToNATWeiPrice); 
        uint256 reservationFee = SafeBips.mulBips(valueNATWei, _state.settings.collateralReservationFeeBIPS);
        require(msg.value >= reservationFee, "not enough fee paid");
        // TODO: what if paid fee is too big?
        uint64 crtId = ++_state.newCrtId;   // pre-increment - id can never be 0
        _state.crts[crtId] = CollateralReservation({
            underlyingValueUBA: SafeCast.toUint128(underlyingValueUBA),
            underlyingFeeUBA: SafeCast.toUint128(underlyingFeeUBA),
            agentVault: _agentVault,
            valueAMG: valueAMG,
            minter: _minter,
            firstUnderlyingBlock: _currentUnderlyingBlock,
            underlyingBlockChallengeTimestamp: 0,   // not challenged
            underlyingBlockVerified: false,
            reservationFeeNatWei: SafeCast.toUint128(reservationFee)
        });
        emit AMEvents.CollateralReserved(_agentVault, _minter, crtId, _lots, 
            underlyingValueUBA, underlyingFeeUBA, lastUnderlyingBlock,
            mintingPaymentReference(crtId));
    }
    
    function collateralReservationTimeout(
        AssetManagerState.State storage _state, 
        uint64 _crtId,
        uint64 _currentUnderlyingBlock  // must be proved
    )
        internal
    {
        CollateralReservations.CollateralReservation storage crt = getCollateralReservation(_state, _crtId);
        // check requirements
        Agents.requireAgentVaultOwner(crt.agentVault);
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(crt.firstUnderlyingBlock, _state.settings.underlyingBlocksForPayment);
        require(_currentUnderlyingBlock >= lastUnderlyingBlock, "timeout too early");
        // send event
        emit AMEvents.CollateralReservationTimeout(crt.agentVault, crt.minter, _crtId);
        // pay the agent crf and delete 
        _cancelCollateralReservation(_state, crt, _crtId);
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
        emit AMEvents.CollateralReservationBlockNumberChallenged(crt.minter, _crtId);
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
        Agents.requireAgentVaultOwner(crt.agentVault);
        emit AMEvents.CollateralReservationBlockNumberChallengeTimeout(crt.agentVault, crt.minter, _crtId);
        // pay the agent crf and delete 
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
        // transfer crt fee to the agent's vault
        IAgentVault(crt.agentVault).deposit{value: crt.reservationFeeNatWei}();
        // release agent's reserved collateral
        releaseCollateralReservation(_state, crt, _crtId);  // crt can't be used after this        
    }
}
