// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../interfaces/IICoreVaultManager.sol";
import "../../utils/lib/MathUtils.sol";
import "../../utils/lib/SafePct.sol";
import "../../userInterfaces/ICoreVault.sol";
import "./data/AssetManagerState.sol";
import "./data/PaymentReference.sol";
import "./AgentCollateral.sol";
import "./Redemptions.sol";
import "./RedemptionRequests.sol";
import "./UnderlyingBalance.sol";


library CoreVault {
    using SafePct for *;
    using SafeCast for *;
    using Agent for Agent.State;
    using AgentCollateral for Collateral.CombinedData;
    using PaymentConfirmations for PaymentConfirmations.State;

    struct State {
        // settings
        IICoreVaultManager coreVaultManager;
        address payable nativeAddress;
        uint16 transferFeeBIPS;
        uint16 redemptionFeeBIPS;
        uint16 minimumAmountLeftBIPS;
        uint64 minimumRedeemLots;

        // state
        bool initialized;
    }

    // doesn't really matter in the contracts, but indicates to the bots that
    // the payment time practically never expires (> 3 years)
    uint64 internal constant TRANSFER_TIME_EXTENSION_SECONDS = 1e8;

    // core vault may not be enabled on all chains
    modifier onlyEnabled {
        _checkEnabled();
        _;
    }

    function transferToCoreVault(
        Agent.State storage _agent,
        uint64 _amountAMG
    )
        internal
        onlyEnabled
    {
        State storage state = getState();
        address agentVault = _agent.vaultAddress();
        // only one transfer can be active
        require(_agent.activeTransferToCoreVault == 0, "transfer already active");
        // close agent's redemption tickets
        (uint64 transferredAMG,) = Redemptions.closeTickets(_agent, _amountAMG, false, false);
        // check the transfer fee
        uint256 transferFeeWei = getTransferFee(transferredAMG);
        require(msg.value >= transferFeeWei, "transfer fee payment too small");
        // check the remaining amount
        (uint256 maximumTransferAMG,) = getMaximumTransferToCoreVaultAMG(_agent);
        require(transferredAMG <= maximumTransferAMG, "too little minting left after transfer");
        // create ordinary redemption request to core vault address
        string memory underlyingAddress = state.coreVaultManager.coreVaultAddress();
        // NOTE: there will be no redemption fee, so the agent needs enough free underlying for the
        // underlying transaction fee, otherwise they will go into full liquidation
        uint64 redemptionRequestId = RedemptionRequests.createRedemptionRequest(
            RedemptionRequests.AgentRedemptionData(_agent.vaultAddress(), transferredAMG),
            state.nativeAddress, underlyingAddress, false, payable(address(0)), 0,
            TRANSFER_TIME_EXTENSION_SECONDS, true);
        // set the active request
        _agent.activeTransferToCoreVault = redemptionRequestId;
        // pay the transfer fee
        Transfers.transferNAT(state.nativeAddress, msg.value);  // guarded by nonReentrant in the facet
        // send event
        uint256 transferredUBA = Conversion.convertAmgToUBA(transferredAMG);
        emit ICoreVault.CoreVaultTransferStarted(agentVault, redemptionRequestId, transferredUBA);
    }

    function cancelTransferToCoreVault(
        Agent.State storage _agent
    )
        internal
        onlyEnabled
    {
        uint64 requestId = _agent.activeTransferToCoreVault;
        require(requestId != 0, "no active transfer");
        Redemption.Request storage request = Redemptions.getRedemptionRequest(requestId);
        Redemptions.reCreateRedemptionTicket(_agent, request);
        Redemptions.deleteRedemptionRequest(requestId);
        emit ICoreVault.CoreVaultTransferCancelled(_agent.vaultAddress(), requestId);
    }

    // only called by RedemptionConfirmations.confirmRedemptionPayment, so all checks are done there
    function confirmTransferToCoreVault(
        IPayment.Proof calldata _payment,
        address _agentVault,
        uint64 _redemptionRequestId
    )
        internal
        onlyEnabled
    {
        State storage state = getState();
        state.coreVaultManager.confirmPayment(_payment);
        uint256 receivedAmount = _payment.data.responseBody.receivedAmount.toUint256();
        emit ICoreVault.CoreVaultTransferSuccessful(_agentVault, _redemptionRequestId, receivedAmount);
    }

    function requestReturnFromCoreVault(
        Agent.State storage _agent,
        uint64 _lots
    )
        internal
        onlyEnabled
    {
        State storage state = getState();
        require(state.coreVaultManager.isDestinationAddressAllowed(_agent.underlyingAddressString),
            "agent's underlying address not allowed by core vault");
        require(_agent.transferFromCoreVaultReservedAMG == 0, "return from core vault already requested");
        Collateral.CombinedData memory collateralData = AgentCollateral.combinedData(_agent);
        require(_lots > 0, "cannot return 0 lots");
        require(_agent.status == Agent.Status.NORMAL, "invalid agent status");
        require(collateralData.freeCollateralLots(_agent) >= _lots, "not enough free collateral");
        uint64 availableLots = getCoreVaultAmountLots();
        require(_lots <= availableLots, "not enough available on core vault");
        uint64 amountAMG = _lots * Globals.getSettings().lotSizeAMG;
        _agent.transferFromCoreVaultReservedAMG = amountAMG;
        _agent.reservedAMG += amountAMG;
        // request
        uint128 amountUBA = Conversion.convertAmgToUBA(amountAMG).toUint128();
        state.coreVaultManager.requestTransferFromCoreVault(_agent.underlyingAddressString, amountUBA, true);
        emit ICoreVault.ReturnFromCoreVaultRequested(_agent.vaultAddress(), amountUBA);
    }

    function cancelReturnFromCoreVault(
        Agent.State storage _agent
    )
        internal
        onlyEnabled
    {
        State storage state = getState();
        state.coreVaultManager.cancelTransferRequestFromCoreVault(_agent.underlyingAddressString);
        _agent.reservedAMG -= _agent.transferFromCoreVaultReservedAMG;
        _agent.transferFromCoreVaultReservedAMG = 0;
        emit ICoreVault.ReturnFromCoreVaultCancelled(_agent.vaultAddress());
    }

    function confirmReturnFromCoreVault(
        IPayment.Proof calldata _payment,
        Agent.State storage _agent
    )
        internal
        onlyEnabled
    {
        State storage state = getState();
        TransactionAttestation.verifyPaymentSuccess(_payment);
        require(_payment.data.responseBody.sourceAddressHash == state.coreVaultManager.coreVaultAddressHash(),
            "payment not from core vault");
        require(_payment.data.responseBody.receivingAddressHash == _agent.underlyingAddressHash,
            "payment not to agent's address");
        // make sure payment isn't used again
        AssetManagerState.get().paymentConfirmations.confirmIncomingPayment(_payment);
        // we account for the option that CV pays more or less than the reserved amount:
        // - if less, only the amount received gets converted to redemption ticket
        // - if more, the extra amount becomes the agent's free underlying
        uint256 receivedAmountUBA = _payment.data.responseBody.receivedAmount.toUint256();
        uint64 receivedAmountAMG = Conversion.convertUBAToAmg(receivedAmountUBA);
        uint64 mintedAmountAMG = SafeMath64.min64(_agent.transferFromCoreVaultReservedAMG, receivedAmountAMG);
        // create redemption ticket
        Agents.createNewMinting(_agent, mintedAmountAMG);
        // update underlying amount
        UnderlyingBalance.increaseBalance(_agent, receivedAmountUBA);
        // clear the reservation
        _agent.reservedAMG -= _agent.transferFromCoreVaultReservedAMG;
        _agent.transferFromCoreVaultReservedAMG = 0;
        uint256 mintedAmountUBA = Conversion.convertAmgToUBA(mintedAmountAMG);
        emit ICoreVault.ReturnFromCoreVaultConfirmed(_agent.vaultAddress(), receivedAmountUBA, mintedAmountUBA);
    }

    function redeemFromCoreVault(
        uint64 _lots,
        string memory _redeemerUnderlyingAddress
    )
        internal
        onlyEnabled
    {
        State storage state = getState();
        require(state.coreVaultManager.isDestinationAddressAllowed(_redeemerUnderlyingAddress),
            "underlying address not allowed by core vault");
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint64 availableLots = getCoreVaultAmountLots();
        require(_lots <= availableLots, "not enough available on core vault");
        uint64 minimumRedeemLots = SafeMath64.min64(state.minimumRedeemLots, availableLots);
        require(_lots >= minimumRedeemLots, "requested amount too small");
        // burn the senders fassets
        uint64 redeemedAMG = _lots * settings.lotSizeAMG;
        uint128 redeemedUBA = Conversion.convertAmgToUBA(redeemedAMG).toUint128();
        Redemptions.burnFAssets(msg.sender, redeemedUBA);
        // transfer from core vault
        state.coreVaultManager.requestTransferFromCoreVault(_redeemerUnderlyingAddress, redeemedUBA, false);
        emit ICoreVault.CoreVaultRedemptionRequested(msg.sender, _redeemerUnderlyingAddress, redeemedUBA);
    }

    function getTransferFee(uint64 _amountAMG)
        internal view
        returns (uint256)
    {
        State storage state = getState();
        uint256 amgToNatWeiPrice = Conversion.currentAmgPriceInTokenWei(Globals.getPoolCollateral());
        uint256 transferAmountWei = Conversion.convertAmgToTokenWei(_amountAMG, amgToNatWeiPrice);
        return transferAmountWei.mulBips(state.transferFeeBIPS);
    }

    function getMaximumTransferToCoreVaultAMG(
        Agent.State storage _agent
    )
        internal view
        returns (uint256 _maximumTransferAMG, uint256 _minimumLeftAmountAMG)
    {
        _minimumLeftAmountAMG = _minimumRemainingAfterTransferAMG(_agent);
        _maximumTransferAMG = MathUtils.subOrZero(_agent.mintedAMG, _minimumLeftAmountAMG);
    }

    function getTotalCoreVaultAmountWithEscrow()
        internal view
        returns (uint256)
    {
        State storage state = getState();
        uint256 allFunds = uint256(state.coreVaultManager.availableFunds() + state.coreVaultManager.escrowedFunds());
        uint256 requestedAmount = uint256(state.coreVaultManager.cancelableTransferRequestsAmount() +
            state.coreVaultManager.nonCancelableTransferRequestsAmount());
        if (allFunds > requestedAmount) {
            return allFunds - requestedAmount;
        }
        return 0;
    }

    function getCoreVaultAmountLots()
        internal view
        returns (uint64)
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        uint64 totalAmountAMG = Conversion.convertUBAToAmg(getTotalCoreVaultAmountWithEscrow());
        return totalAmountAMG / settings.lotSizeAMG;
    }

    function _minimumRemainingAfterTransferAMG(
        Agent.State storage _agent
    )
        private view
        returns (uint256)
    {
        Collateral.CombinedData memory cd = AgentCollateral.combinedData(_agent);
        uint256 resultWRTVault = _minimumRemainingAfterTransferForCollateralAMG(_agent, cd.agentCollateral);
        uint256 resultWRTPool = _minimumRemainingAfterTransferForCollateralAMG(_agent, cd.poolCollateral);
        uint256 resultWRTAgentPT = _minimumRemainingAfterTransferForCollateralAMG(_agent, cd.agentPoolTokens);
        return Math.min(resultWRTVault, Math.min(resultWRTPool, resultWRTAgentPT));
    }

    function _minimumRemainingAfterTransferForCollateralAMG(
        Agent.State storage _agent,
        Collateral.Data memory _data
    )
        private view
        returns (uint256)
    {
        State storage state = getState();
        (, uint256 systemMinCrBIPS) = AgentCollateral.mintingMinCollateralRatio(_agent, _data.kind);
        uint256 collateralEquivAMG = Conversion.convertTokenWeiToAMG(_data.fullCollateral, _data.amgToTokenWeiPrice);
        uint256 maxSupportedAMG = collateralEquivAMG.mulDiv(SafePct.MAX_BIPS, systemMinCrBIPS);
        return maxSupportedAMG.mulBips(state.minimumAmountLeftBIPS);
    }

    function _checkEnabled() private view {
        State storage state = getState();
        require(address(state.coreVaultManager) != address(0), "core vault not enabled");
    }

    bytes32 internal constant STATE_POSITION = keccak256("fasset.CoreVault.State");

    function getState()
        internal pure
        returns (State storage _state)
    {
        bytes32 position = STATE_POSITION;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            _state.slot := position
        }
    }
}
