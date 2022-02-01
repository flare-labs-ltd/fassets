// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "../../utils/lib/SafeMath64.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./CollateralReservations.sol";
import "./AssetManagerState.sol";


library Minting {
    using SafeMath for uint256;
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentVerification for PaymentVerification.State;
    
    function mintingExecuted(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        uint64 _crtId
    )
        internal
        returns (address _minter, uint256 _mintValueUBA)
    {
        CollateralReservations.CollateralReservation storage crt = 
            CollateralReservations.getCollateralReservation(_state, _crtId);
        require(msg.sender == crt.minter, "only minter");
        require(_paymentInfo.paymentReference == CollateralReservations.mintingPaymentReference(_crtId),
            "invalid payment reference");
        Agents.Agent storage agent = Agents.getAgent(_state, crt.agentVault);
        _minter = crt.minter;
        _mintValueUBA = crt.underlyingValueUBA;
        uint256 expectedPaymentUBA = uint256(crt.underlyingValueUBA).add(crt.underlyingFeeUBA);
        PaymentVerification.validatePaymentDetails(_paymentInfo, 
            0 /* not used */, agent.underlyingAddressHash, expectedPaymentUBA);
        _state.paymentVerifications.confirmPayment(_paymentInfo);
        address agentVault = crt.agentVault;
        uint64 valueAMG = crt.valueAMG;
        uint64 redemptionTicketId = _state.redemptionQueue.createRedemptionTicket(agentVault, valueAMG);
        emit AMEvents.MintingExecuted(agentVault, _crtId, redemptionTicketId, _mintValueUBA, crt.underlyingFeeUBA);
        Agents.allocateMintedAssets(_state, agentVault, valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_state, crt.agentVault, crt.underlyingFeeUBA);
        // burn collateral reservation fee (guarded against reentrancy in AssetManager.executeMinting)
        _state.settings.burnAddress.transfer(crt.reservationFeeNatWei);
        // cleanup
        CollateralReservations.releaseCollateralReservation(_state, crt, _crtId);   // crt can't be used after this
    }

    function selfMint(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault,
        uint64 _lots
    )
        internal
        returns (uint256 _mintValueUBA)
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(_lots > 0, "cannot mint 0 blocks");
        require(agent.agentType == Agents.AgentType.AGENT_100, "wrong agent type for self-mint");
        require(!Agents.isAgentInLiquidation(_state, _agentVault), "agent in liquidation");
        require(_paymentInfo.paymentReference == bytes32(uint256(_agentVault)), "invalid payment reference");
        uint256 fullCollateral = IAgentVault(_agentVault).fullCollateral();
        uint256 amgToNATWeiPrice = Conversion.currentAmgToNATWeiPrice(_state.settings);
        require(Agents.freeCollateralLots(agent, _state.settings, fullCollateral, amgToNATWeiPrice) >= _lots,
            "not enough free collateral");
        uint64 valueAMG = SafeMath64.mul64(_lots, _state.settings.lotSizeAMG);
        _mintValueUBA = uint256(valueAMG) * _state.settings.assetMintingGranularityUBA;
        PaymentVerification.validatePaymentDetails(_paymentInfo, 
            0 /* not used */, agent.underlyingAddressHash, _mintValueUBA);
        _state.paymentVerifications.confirmPayment(_paymentInfo);
        uint64 redemptionTicketId = _state.redemptionQueue.createRedemptionTicket(_agentVault, valueAMG);
        emit AMEvents.MintingExecuted(_agentVault, 0, redemptionTicketId, _mintValueUBA, 0);
        Agents.allocateMintedAssets(_state, _agentVault, valueAMG);
    }
}
