// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../utils/lib/SafePct.sol";
import "../../userInterfaces/ICoreVault.sol";
import "./data/AssetManagerState.sol";
import "./data/PaymentReference.sol";
import "./Redemptions.sol";
import "./RedemptionRequests.sol";
import "./RedemptionRequests.sol";


library CoreVault {
    using SafePct for *;
    using Agent for Agent.State;

    struct State {
        // settings
        address payable nativeAddress;
        address payable executorAddress;
        string underlyingAddressString;
        uint32 redemptionFeeBIPS;
        uint32 transferTimeExtensionSeconds;

        // state
        bool initialized;
        uint64 lastRedemptionRequestId;
        uint64 mintedAMG;
    }

    function transferToCoreVault(
        Agent.State storage _agent,
        uint64 _amountAMG
    )
        internal
    {
        State storage state = getState();
        address agentVault = _agent.vaultAddress();
        // TODO: value (fee) gets paid to the core vault
        // close agent's redemption tickets
        (uint64 transferredAMG,) = Redemptions.closeTickets(_agent, _amountAMG, false, false);
        // create ordinary redemption request to core vault address
        // NOTE: there will be no redemption fee, so the agent needs enough free underlying for the
        //  underlying transaction fee, otherwise they will go into full liquidation
        uint64 redemptionRequestId = RedemptionRequests.createRedemptionRequest(
            RedemptionRequests.AgentRedemptionData(_agent.vaultAddress(), transferredAMG),
            state.nativeAddress, state.underlyingAddressString, false, state.executorAddress, 0,
            state.transferTimeExtensionSeconds, true);
        // immediately take over backing
        state.mintedAMG += transferredAMG;
        // send event
        emit ICoreVault.CoreVaultTransferStarted(agentVault, redemptionRequestId,
            Conversion.convertAmgToUBA(_amountAMG));
    }

    function redeemFromCoreVault(
        address _redeemer,
        uint64 _lots,
        string memory _redeemerUnderlyingAddress
    )
        internal
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
