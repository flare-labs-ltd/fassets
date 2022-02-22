// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./UnderlyingFreeBalance.sol";
import "./CollateralReservations.sol";
import "./AssetManagerState.sol";
import "./AgentCollateral.sol";
import "./PaymentReference.sol";


library Minting {
    using RedemptionQueue for RedemptionQueue.State;
    using PaymentVerification for PaymentVerification.State;
    using AgentCollateral for AgentCollateral.Data;
    
    function mintingExecuted(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        uint64 _crtId
    )
        external
        returns (address _minter, uint256 _mintValueUBA)
    {
        CollateralReservations.CollateralReservation storage crt = 
            CollateralReservations.getCollateralReservation(_state, _crtId);
        _minter = crt.minter;
        _mintValueUBA = crt.underlyingValueUBA;
        address agentVault = crt.agentVault;
        Agents.Agent storage agent = Agents.getAgent(_state, agentVault);
        require(msg.sender == crt.minter, "only minter");
        uint256 expectedPaymentUBA = uint256(crt.underlyingValueUBA) + crt.underlyingFeeUBA;
        require(_paymentInfo.paymentReference == PaymentReference.minting(_crtId),
            "invalid minting reference");
        require(_paymentInfo.targetAddressHash == agent.underlyingAddressHash, 
            "minting not agent's address");
        require(_paymentInfo.deliveredUBA >= expectedPaymentUBA,
            "minting payment too small");
        _state.paymentVerifications.confirmPayment(_paymentInfo);
        uint64 redemptionTicketId = _state.redemptionQueue.createRedemptionTicket(agentVault, crt.valueAMG);
        emit AMEvents.MintingExecuted(agentVault, _crtId, redemptionTicketId, _mintValueUBA, crt.underlyingFeeUBA);
        Agents.allocateMintedAssets(_state, agentVault, crt.valueAMG);
        UnderlyingFreeBalance.increaseFreeBalance(_state, agentVault, crt.underlyingFeeUBA);
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
        external
        returns (uint256 _mintValueUBA)
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        AgentCollateral.Data memory collateralData = AgentCollateral.currentData(_state, _agentVault);
        require(_lots > 0, "cannot mint 0 blocks");
        require(agent.agentType == Agents.AgentType.AGENT_100, "wrong agent type for self-mint");
        require(!Agents.isAgentInLiquidation(_state, _agentVault), "agent in liquidation");
        require(collateralData.freeCollateralLots(agent, _state.settings) >= _lots, "not enough free collateral");
        uint64 valueAMG = _lots * _state.settings.lotSizeAMG;
        _mintValueUBA = uint256(valueAMG) * _state.settings.assetMintingGranularityUBA;
        require(_paymentInfo.paymentReference == PaymentReference.selfMint(_agentVault), 
            "invalid self-mint reference");
        require(_paymentInfo.targetAddressHash == agent.underlyingAddressHash, 
            "self-mint not agent's address");
        require(_paymentInfo.deliveredUBA >= _mintValueUBA, 
            "self-mint payment too small");
        _state.paymentVerifications.confirmPayment(_paymentInfo);
        uint64 redemptionTicketId = _state.redemptionQueue.createRedemptionTicket(_agentVault, valueAMG);
        emit AMEvents.MintingExecuted(_agentVault, 0, redemptionTicketId, _mintValueUBA, 0);
        Agents.allocateMintedAssets(_state, _agentVault, valueAMG);
    }
}
