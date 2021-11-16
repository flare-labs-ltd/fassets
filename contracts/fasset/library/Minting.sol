// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "../../utils/lib/SafeMath64.sol";
import "./Agents.sol";
import "./AgentUnderlyingFunds.sol";
import "./CollateralReservations.sol";
import "./AssetManagerState.sol";


library Minting {
    using SafeMath for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentVerification for PaymentVerification.State;
    
    event MintingExecuted(
        address indexed vaultAddress,
        uint256 collateralReservationId,
        uint256 redemptionTicketId,
        bytes32 underlyingAddress,
        uint256 mintedLots,
        uint256 receivedFeeUBA);

    function mintingExecuted(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        uint64 _crtId
    )
        internal
    {
        CollateralReservations.CollateralReservation storage crt = 
            CollateralReservations.getCollateralReservation(_state, _crtId);
        uint256 expectedPaymentUBA = uint256(crt.underlyingValueUBA).add(crt.underlyingFeeUBA);
        _state.paymentVerifications.verifyPaymentDetails(_paymentInfo, 
            crt.minterUnderlyingAddress, crt.agentUnderlyingAddress, expectedPaymentUBA, 
            crt.firstUnderlyingBlock, crt.lastUnderlyingBlock);
        address agentVault = crt.agentVault;
        uint64 lots = crt.lots;
        bytes32 underlyingAddress = crt.agentUnderlyingAddress;
        uint64 redemptionTicketId = 
            _state.redemptionQueue.createRedemptionTicket(agentVault, lots, underlyingAddress);
        Agents.Agent storage agent = _state.agents[agentVault];
        if (crt.availabilityEnterCountMod2 == agent.availabilityEnterCountMod2) {
            agent.reservedLots = SafeMath64.sub64(agent.reservedLots, lots, "invalid reserved lots");
        } else {
            agent.oldReservedLots = SafeMath64.sub64(agent.oldReservedLots, lots, "invalid reserved lots");
        }
        agent.mintedLots = SafeMath64.add64(agent.mintedLots, lots);
        Agents.UnderlyingFunds storage uaf = agent.perAddressFunds[underlyingAddress];
        uaf.mintedLots = SafeMath64.add64(uaf.mintedLots, lots);
        AgentUnderlyingFunds.increaseFreeBalance(_state, crt.agentVault, underlyingAddress, crt.underlyingFeeUBA);
        emit MintingExecuted(agentVault, _crtId, redemptionTicketId, underlyingAddress, lots, crt.underlyingFeeUBA);
        delete _state.crts[_crtId];
    }
    
}
