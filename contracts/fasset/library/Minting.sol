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
        Agents.requireOwnerAgent(crt.agentVault);
        Agents.Agent storage agent = Agents.getAgent(_state, crt.agentVault);
        uint256 expectedPaymentUBA = uint256(crt.underlyingValueUBA).add(crt.underlyingFeeUBA);
        PaymentVerification.validatePaymentDetails(_paymentInfo, 
            crt.minterUnderlyingAddress, agent.underlyingAddress, expectedPaymentUBA);
        _state.paymentVerifications.confirmPayment(_paymentInfo);
        address agentVault = crt.agentVault;
        uint64 valueAMG = crt.valueAMG;
        uint64 redemptionTicketId = _state.redemptionQueue.createRedemptionTicket(agentVault, valueAMG);
        emit MintingExecuted(agentVault, _crtId, redemptionTicketId, crt.underlyingFeeUBA);
        Agents.allocateMintedAssets(_state, agentVault, valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_state, crt.agentVault, crt.underlyingFeeUBA);
        CollateralReservations.releaseCollateralReservation(_state, crt, _crtId);   // crt can't be used after this
        // TODO: burn reservation fee?
        // Few things to check: what is the burn address, how much to burn (what if crf changes between mint and now?), reentrancy
    }
    
}
