// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../utils/lib/SafeMath64.sol";
import "./AMEvents.sol";
import "./Agents.sol";
import "./PaymentVerification.sol";
import "./AssetManagerState.sol";
import "./Liquidation.sol";


library UnderlyingFreeBalance {
    using SafeMath for uint256;
    using SignedSafeMath for int256;
    using PaymentVerification for PaymentVerification.State;

    bytes32 internal constant TOPUP_PAYMENT_REFERENCE = 0;
    
    function updateFreeBalance(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _balanceAdd,
        uint256 _balanceSub,
        uint64 _currentUnderlyingBlock
    ) 
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        // assert((uaf.freeUnderlyingBalanceUBA >= 0) == (uaf.lastUnderlyingBlockForTopup == 0));
        int256 newBalance = int256(agent.freeUnderlyingBalanceUBA)
            .add(SafeCast.toInt256(_balanceAdd))
            .sub(SafeCast.toInt256(_balanceSub));
        agent.freeUnderlyingBalanceUBA = SafeCast.toInt128(newBalance);
        if (newBalance < 0) {
            if (agent.lastUnderlyingBlockForTopup == 0) {
                require(_currentUnderlyingBlock != 0, "cannot set last topup block");
                agent.lastUnderlyingBlockForTopup = 
                    SafeMath64.add64(_currentUnderlyingBlock, _state.settings.underlyingBlocksForTopup);
            }
            uint256 topup = SafeCast.toUint256(-newBalance);   // required topup is negative balance
            emit AMEvents.TopupRequired(_agentVault, topup, agent.lastUnderlyingBlockForTopup);
        } else if (agent.lastUnderlyingBlockForTopup != 0) {
            agent.lastUnderlyingBlockForTopup = 0;
        }
    }

    function increaseFreeBalance(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _balanceIncrease
    ) 
        internal
    {
        // _currentUnderlyingBlock can be 0 here, since if new balance is < 0, then
        // lastUnderlyingBlockForTopup must have been set before
        updateFreeBalance(_state, _agentVault, _balanceIncrease, 0, 0);
    }

    function confirmTopupPayment(
        AssetManagerState.State storage _state,
        PaymentVerification.UnderlyingPaymentInfo memory _paymentInfo,
        address _agentVault
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.underlyingAddressHash == _paymentInfo.sourceAddressHash, 
            "not underlying address");
        require(_paymentInfo.paymentReference == TOPUP_PAYMENT_REFERENCE,
            "not a topup payment");
        _state.paymentVerifications.confirmPayment(_paymentInfo);
        increaseFreeBalance(_state, _agentVault, _paymentInfo.deliveredUBA);
    }
    
    function withdrawFreeFunds(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint256 _valueUBA
    )
        internal
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.freeUnderlyingBalanceUBA >= 0 && uint128(agent.freeUnderlyingBalanceUBA) >= _valueUBA, 
            "payment larger than allowed");
        agent.freeUnderlyingBalanceUBA -= int128(int256(_valueUBA));   // guarded by require
    }
    
    function triggerTopupLiquidation(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _currentUnderlyingBlock
    )
        external
    {
        Agents.Agent storage agent = Agents.getAgent(_state, _agentVault);
        require(agent.lastUnderlyingBlockForTopup != 0 && agent.lastUnderlyingBlockForTopup < _currentUnderlyingBlock,
            "no overdue topup");
        // start liquidation until address balance is healthy
        Liquidation.startLiquidation(_state, _agentVault, false);
    }
}
