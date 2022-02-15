// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeBips.sol";
import "./Conversion.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./AssetManagerState.sol";
import "../interface/IAgentVault.sol";
import "./AgentCollateral.sol";
import "./PaymentReference.sol";


library CollateralReservations {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using AgentCollateral for AgentCollateral.Data;
    
    struct CollateralReservation {
        uint128 underlyingValueUBA;
        uint128 underlyingFeeUBA;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
        uint64 lastUnderlyingTimestamp;
        address agentVault;
        uint64 valueAMG;
        address minter;
        uint128 reservationFeeNatWei;
    }
    
    function reserveCollateral(
        AssetManagerState.State storage _state, 
        address _minter,
        address _agentVault,
        uint64 _lots
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, _agentVault);
        require(agent.availableAgentsPos != 0, "agent not in mint queue");
        require(_lots > 0, "cannot mint 0 blocks");
        require(!Agents.isAgentInLiquidation(_state, _agentVault), "agent in liquidation");
        require(collateralData.freeCollateralLots(agent, _state.settings) >= _lots, "not enough free collateral");
        uint64 valueAMG = SafeMath64.mul64(_lots, _state.settings.lotSizeAMG);
        agent.reservedAMG = SafeMath64.add64(agent.reservedAMG, valueAMG);
        uint256 underlyingValueUBA = Conversion.convertAmgToUBA(_state.settings, valueAMG);
        uint256 underlyingFeeUBA = underlyingValueUBA.mulBips(agent.feeBIPS);
        uint256 reservationFee = _reservationFee(_state, collateralData, valueAMG);
        require(msg.value >= reservationFee, "not enough fee paid");
        // TODO: what if paid fee is too big?
        (uint64 lastUnderlyingBlock, uint64 lastUnderlyingTimestamp) = _lastPaymentBlock(_state);
        uint64 crtId = ++_state.newCrtId;   // pre-increment - id can never be 0
        _state.crts[crtId] = CollateralReservation({
            underlyingValueUBA: SafeCast.toUint128(underlyingValueUBA),
            underlyingFeeUBA: SafeCast.toUint128(underlyingFeeUBA),
            agentVault: _agentVault,
            valueAMG: valueAMG,
            minter: _minter,
            firstUnderlyingBlock: _state.currentUnderlyingBlock,
            lastUnderlyingBlock: lastUnderlyingBlock,
            lastUnderlyingTimestamp: lastUnderlyingTimestamp,
            reservationFeeNatWei: SafeCast.toUint128(reservationFee)
        });
        bytes storage paymentAddress = agent.underlyingAddressString;
        emit AMEvents.CollateralReserved(_agentVault,
            _minter,
            crtId,
            underlyingValueUBA,
            underlyingFeeUBA, 
            lastUnderlyingBlock,
            lastUnderlyingTimestamp,
            paymentAddress,
            PaymentReference.minting(crtId));
    }
    
    function collateralReservationTimeout(
        AssetManagerState.State storage _state, 
        IAttestationClient.ReferencedPaymentNonexistence calldata _nonPayment,
        uint64 _crtId
    )
        external
    {
        CollateralReservations.CollateralReservation storage crt = getCollateralReservation(_state, _crtId);
        Agents.Agent storage agent = Agents.getAgent(_state, crt.agentVault);
        // check requirements
        require(_nonPayment.paymentReference == PaymentReference.minting(_crtId) &&
            _nonPayment.destinationAddress == agent.underlyingAddressHash &&
            _nonPayment.amount == crt.underlyingValueUBA + crt.underlyingFeeUBA,
            "minting non-payment mismatch");
        require(_nonPayment.firstOverflowBlock > crt.lastUnderlyingBlock && 
            _nonPayment.firstOverflowBlockTimestamp > crt.lastUnderlyingTimestamp, 
            "minting default too early");
        require(_nonPayment.firstCheckedBlock <= crt.firstUnderlyingBlock,
            "minting request too old");
        Agents.requireAgentVaultOwner(crt.agentVault);
        // send event
        emit AMEvents.CollateralReservationTimeout(crt.agentVault, crt.minter, _crtId);
        // transfer crt fee to the agent's vault
        IAgentVault(crt.agentVault).deposit{value: crt.reservationFeeNatWei}();
        // release agent's reserved collateral
        releaseCollateralReservation(_state, crt, _crtId);  // crt can't be used after this        
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
    
    function _lastPaymentBlock(AssetManagerState.State storage _state)
        private view
        returns (uint64 _lastUnderlyingBlock, uint64 _lastUnderlyingTimestamp)
    {
        // timeshift amortizes for the time that passed from the last underlying block update
        uint64 timeshift = 
            SafeCast.toUint64(block.timestamp) - _state.currentUnderlyingBlockUpdatedAt;
        _lastUnderlyingBlock =
            _state.currentUnderlyingBlock + _state.settings.underlyingBlocksForPayment;
        _lastUnderlyingTimestamp = 
            _state.currentUnderlyingBlockTimestamp + timeshift + _state.settings.underlyingSecondsForPayment;
    }

    function _reservationFee(
        AssetManagerState.State storage _state,
        AgentCollateral.Data memory collateralData,
        uint64 _valueAMG
    )
        private view
        returns (uint256)
    {
        uint256 valueNATWei = Conversion.convertAmgToNATWei(_valueAMG, collateralData.amgToNATWeiPrice); 
        return SafeBips.mulBips(valueNATWei, _state.settings.collateralReservationFeeBIPS);
    }
}
