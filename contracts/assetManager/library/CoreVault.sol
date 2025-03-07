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


library CoreVault {
    using SafePct for *;
    using Agent for Agent.State;

    struct State {
        // settings
        IICoreVaultManager coreVaultManager;
        address payable nativeAddress;
        uint16 transferFeeBIPS;
        uint32 redemptionFeeBIPS;
        uint32 transferTimeExtensionSeconds;
        uint16 minimumAmountLeftBIPS;

        // state
        bool initialized;
        uint64 lastRedemptionRequestId;
        uint64 mintedAMG;
    }

    // core vault may not be enabled on all chains
    modifier onlyEnabled {
        State storage state = getState();
        require(address(state.coreVaultManager) != address(0), "core vault not enabled");
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
        require(_agent.activeCoreVaultTransfer == 0, "transfer already active");
        // TODO: value (fee) gets paid to the core vault
        // close agent's redemption tickets
        (uint64 transferredAMG,) = Redemptions.closeTickets(_agent, _amountAMG, false, false);
        // check the transfer fee
        uint256 transferFeeWei = getTransferFee(_amountAMG);
        require(msg.value >= transferFeeWei, "transfer fee payment too small");
        // check the remaining amount
        (uint256 maximumTransferAMG,) = getMaximumTransferAMG(_agent);
        require(_amountAMG <= maximumTransferAMG, "too little minting left after transfer");
        // create ordinary redemption request to core vault address
        string memory underlyingAddress = state.coreVaultManager.coreVaultAddress();
        // NOTE: there will be no redemption fee, so the agent needs enough free underlying for the
        // underlying transaction fee, otherwise they will go into full liquidation
        uint64 redemptionRequestId = RedemptionRequests.createRedemptionRequest(
            RedemptionRequests.AgentRedemptionData(_agent.vaultAddress(), transferredAMG),
            state.nativeAddress, underlyingAddress, false, payable(address(0)), 0,
            state.transferTimeExtensionSeconds, true);
        // set the active request
        _agent.activeCoreVaultTransfer = redemptionRequestId;
        // immediately take over backing
        state.mintedAMG += transferredAMG;
        // pay the transfer fee
        Transfers.transferNAT(state.nativeAddress, msg.value);  // guarded by nonReentrant in the facet
        // send event
        emit ICoreVault.CoreVaultTransferStarted(agentVault, redemptionRequestId,
            Conversion.convertAmgToUBA(_amountAMG));
    }

    function cancelTransferToCoreVault(
        Agent.State storage _agent
    )
        internal
        onlyEnabled
    {
        uint64 requestId = _agent.activeCoreVaultTransfer;
        require(requestId != 0, "no active transfer");
        Redemption.Request storage request = Redemptions.getRedemptionRequest(requestId);
        Redemptions.reCreateRedemptionTicket(_agent, request);
        Redemptions.deleteRedemptionRequest(requestId);
    }

    function redeemFromCoreVault(
        address _redeemer,
        uint64 _lots,
        string memory _redeemerUnderlyingAddress
    )
        internal
        onlyEnabled
        returns (uint64 _redeemedLots)
    {
        State storage state = getState();
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        _redeemedLots = SafeMath64.min64(_lots, state.mintedAMG / settings.lotSizeAMG);
        uint64 redeemedAMG = _redeemedLots * settings.lotSizeAMG;
        state.mintedAMG -= redeemedAMG;
        uint64 requestId = ++state.lastRedemptionRequestId;
        uint256 redeemedUBA = Conversion.convertAmgToUBA(redeemedAMG);
        uint256 feeUBA = redeemedUBA.mulBips(state.redemptionFeeBIPS);
        bytes32 paymentReference = PaymentReference.coreVaultRedemption(requestId);
        emit ICoreVault.CoreVaultRedemption(_redeemer, requestId, _redeemerUnderlyingAddress,
            redeemedUBA, feeUBA, paymentReference);
    }

    function confirmCoreVaultTransferPayment(
        IPayment.Proof calldata _payment,
        address _agentVault,
        uint64 _redemptionRequestId
    )
        internal
        onlyEnabled
    {
        State storage state = getState();
        state.coreVaultManager.confirmPayment(_payment);
        uint256 receivedAmount = SafeCast.toUint256(_payment.data.responseBody.receivedAmount);
        emit ICoreVault.CoreVaultTransferSuccessful(_agentVault, _redemptionRequestId, receivedAmount);
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

    function getMaximumTransferAMG(
        Agent.State storage _agent
    )
        internal view
        returns (uint256 _maximumTransferAMG, uint256 _minimumLeftAmountAMG)
    {
        _minimumLeftAmountAMG = _minimumRemainingAfterTransferAMG(_agent);
        _maximumTransferAMG = MathUtils.subOrZero(_agent.mintedAMG, _minimumLeftAmountAMG);
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
