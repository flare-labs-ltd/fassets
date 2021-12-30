// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "./Agents.sol";
import "./UnderlyingAddressOwnership.sol";
import "./AssetManagerState.sol";


library CollateralReservations {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using Agents for Agents.Agent;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    
    struct CollateralReservation {
        bytes32 minterUnderlyingAddress;
        uint128 underlyingValueUBA;
        uint64 firstUnderlyingBlock;
        uint128 underlyingFeeUBA;
        uint64 lastUnderlyingBlock;
        address agentVault;
        uint64 valueAMG;
        address minter;
        uint8 availabilityEnterCountMod2;
    }

    event CollateralReserved(
        address indexed agentVault,
        address indexed minter,
        uint256 collateralReservationId,
        uint64 reservedLots,
        uint256 underlyingValueUBA, 
        uint256 underlyingFeeUBA,
        uint256 lastUnderlyingBlock);

    event CollateralReservationTimeout(
        address indexed agentVault,
        address indexed minter,
        uint256 collateralReservationId);
        
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
        Agents.Agent storage agent = _state.agents[_agentVault];
        require(agent.availableAgentsPos != 0, "agent not in mint queue");
        require(_lots > 0, "cannot mint 0 blocks");
        require(!Agents.isAgentInLiquidation(_state, _agentVault), "agent in liquidation");
        require(agent.freeCollateralLots(_state.settings, _fullAgentCollateral, _amgToNATWeiPrice) >= _lots,
            "not enough free collateral");

        _state.underlyingAddressOwnership.claim(_minter, _minterUnderlyingAddress);
        uint64 lastUnderlyingBlock = 
            SafeMath64.add64(_currentUnderlyingBlock, _state.settings.underlyingBlocksForPayment);
        uint64 valueAMG = SafeMath64.mul64(_lots, _state.settings.lotSizeAMG);
        agent.reservedAMG = SafeMath64.add64(agent.reservedAMG, valueAMG);
        uint256 underlyingValueUBA = uint256(_state.settings.assetMintingGranularityUBA).mul(valueAMG);
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
            lastUnderlyingBlock: lastUnderlyingBlock,
            availabilityEnterCountMod2: agent.availabilityEnterCountMod2
        });
        emit CollateralReserved(_agentVault, _minter, crtId, _lots, 
            underlyingValueUBA, underlyingFeeUBA, lastUnderlyingBlock);
    }
    
    function reservationTimeout(
        AssetManagerState.State storage _state, 
        uint64 _crtId,
        uint64 _currentUnderlyingBlock
    )
        internal
    {
        CollateralReservations.CollateralReservation storage crt = getCollateralReservation(_state, _crtId);
        require(_currentUnderlyingBlock >= crt.lastUnderlyingBlock, "timeout too early");
        Agents.requireOwnerAgent(crt.agentVault);
        emit CollateralReservationTimeout(crt.agentVault, crt.minter, _crtId);
        releaseCollateralReservation(_state, crt, _crtId);  // crt can't be used after this
        // TODO: pay fee to agent?
    }

    function releaseCollateralReservation(
        AssetManagerState.State storage _state,
        CollateralReservations.CollateralReservation storage crt,
        uint64 _crtId
    )
        internal
    {
        Agents.Agent storage agent = _state.agents[crt.agentVault];
        if (crt.availabilityEnterCountMod2 == agent.availabilityEnterCountMod2) {
            agent.reservedAMG = SafeMath64.sub64(agent.reservedAMG, crt.valueAMG, "invalid reservation");
        } else {
            agent.oldReservedAMG = SafeMath64.sub64(agent.oldReservedAMG, crt.valueAMG, "invalid reservation");
        }
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
}
