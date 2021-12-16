// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "../../utils/lib/SafeMath64.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./CollateralReservations.sol";
import "./AssetManagerState.sol";


library Minting {
    using SafeMath for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentVerification for PaymentVerification.State;
    
    event MintingExecuted(
        address indexed agentVault,
        uint256 collateralReservationId,
        uint256 redemptionTicketId,
        bytes32 underlyingAddress,
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
        Agents.requireAgent(crt.agentVault);
        uint256 expectedPaymentUBA = uint256(crt.underlyingValueUBA).add(crt.underlyingFeeUBA);
        _state.paymentVerifications.confirmPaymentDetails(_paymentInfo, 
            crt.minterUnderlyingAddress, crt.agentUnderlyingAddress, expectedPaymentUBA, 
            crt.firstUnderlyingBlock, crt.lastUnderlyingBlock);
        address agentVault = crt.agentVault;
        uint64 valueAMG = crt.valueAMG;
        bytes32 underlyingAddress = crt.agentUnderlyingAddress;
        uint64 redemptionTicketId = 
            _state.redemptionQueue.createRedemptionTicket(agentVault, valueAMG, underlyingAddress);
        emit MintingExecuted(agentVault, _crtId, redemptionTicketId, underlyingAddress, crt.underlyingFeeUBA);
        Agents.allocateMintedAssets(_state, agentVault, underlyingAddress, valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_state, crt.agentVault, underlyingAddress, crt.underlyingFeeUBA);
        CollateralReservations.releaseCollateralReservation(_state, crt, _crtId);   // crt can't be used after this
        // TODO: burn reservation fee?
    }
    
}
