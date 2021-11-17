// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/SignedSafeMath.sol";
import "../../utils/lib/SafeMath64.sol";
import "../../utils/lib/SafeMathX.sol";
import "./Agents.sol";
import "./UnderlyingAddressOwnership.sol";
import "./PaymentVerification.sol";
import "./AssetManagerState.sol";


library UnderlyingFreeBalance {
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    using PaymentVerification for PaymentVerification.State;
    
    event TopupRequired(
        address indexed vaultAddress,
        bytes32 underlyingAddress,
        uint256 valueUBA,
        uint64 lastUnderlyingBlock);

    function updateFreeBalance(
        AssetManagerState.State storage _state, 
        address _agentVault,
        bytes32 _underlyingAddress,
        uint256 _balanceAdd,
        uint256 _balanceSub,
        uint64 _currentUnderlyingBlock
    ) 
        internal
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        Agents.UnderlyingFunds storage uaf = agent.perAddressFunds[_underlyingAddress];
        // assert((uaf.freeBalanceUBA >= 0) == (uaf.lastUnderlyingBlockForTopup == 0));
        int256 newBalance = uaf.freeBalanceUBA
            .add(SafeMathX.toInt256(_balanceAdd))
            .sub(SafeMathX.toInt256(_balanceSub));
        uaf.freeBalanceUBA = newBalance;
        if (newBalance < 0) {
            if (uaf.lastUnderlyingBlockForTopup == 0) {
                require(_currentUnderlyingBlock != 0, "cannot set last topup block");
                uaf.lastUnderlyingBlockForTopup =
                    SafeMath64.add64(_currentUnderlyingBlock, _state.settings.underlyingBlocksForTopup);
            }
            uint256 topup = SafeMathX.toUint256(-newBalance);   // required topup is negative balance
            emit TopupRequired(_agentVault, _underlyingAddress, topup, uaf.lastUnderlyingBlockForTopup);
        } else if (uaf.lastUnderlyingBlockForTopup != 0) {
            uaf.lastUnderlyingBlockForTopup = 0;
        }
    }

    function increaseFreeBalance(
        AssetManagerState.State storage _state, 
        address _agentVault,
        bytes32 _underlyingAddress,
        uint256 _balanceIncrease
    ) 
        internal
    {
        // _currentUnderlyingBlock can be 0 here, since if new balance is < 0, then
        // lastUnderlyingBlockForTopup must have been set before
        updateFreeBalance(_state, _agentVault, _underlyingAddress, _balanceIncrease, 0, 0);
    }

    function confirmTopupPayment(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault
    )
        internal
    {
        // TODO: check that payment info is not too old? (to prevent submitting already verified and expired proofs - 
        // probably not necessary, since state connector cannot prove such old payments)
        _state.underlyingAddressOwnership.check(_agentVault, _paymentInfo.sourceAddress);
        _state.paymentVerifications.verifyPayment(_paymentInfo);
        increaseFreeBalance(_state, _agentVault, _paymentInfo.targetAddress, _paymentInfo.valueUBA);
    }
}
