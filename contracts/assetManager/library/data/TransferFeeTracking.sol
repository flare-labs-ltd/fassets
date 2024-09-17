// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../../../utils/lib/SafePct.sol";
import "../../../utils/lib/TimeCumulative.sol";


library TransferFeeTracking {
    using SafeCast for uint256;
    using TimeCumulative for TimeCumulative.Data;

    struct AgentData {
        TimeCumulative.Data mintingHistory;
        uint64 firstUnclaimedEpoch;
    }

    struct ClaimEpoch {
        uint128 totalFees;
        uint128 cumulativeMinted;
    }

    struct Data {
        TimeCumulative.Data totalMintingHistory;

        // claim epochs data
        mapping(uint256 => ClaimEpoch) epochs;
        uint64 firstEpochTimestamp;
        uint64 epochDuration;
        uint64 maxUnexpiredEpochs;
        uint64 firstClaimableEpoch;

        // per agent data
        mapping(address agentVault => AgentData) agents;
    }

    uint256 internal constant CLEANUP_HISTORY_POINTS = 2;
    uint256 internal constant MAX_SINGLE_CLAIM_EPOCHS = type(uint128).max;
    uint128 internal constant UNINITIALIZED = type(uint128).max;

    function increaseMinting(Data storage _data, address _agentVault, uint64 _amountAMG) internal {
        AgentData storage agent = _data.agents[_agentVault];
        agent.mintingHistory.addDataPoint(block.timestamp, agent.mintingHistory.lastValue() + _amountAMG);
        _data.totalMintingHistory.addDataPoint(block.timestamp, _data.totalMintingHistory.lastValue() + _amountAMG);
        _cleanupSomeHistory(_data, agent);
    }

    function decreaseMinting(Data storage _data, address _agentVault, uint64 _amountAMG) internal {
        AgentData storage agent = _data.agents[_agentVault];
        agent.mintingHistory.addDataPoint(block.timestamp, agent.mintingHistory.lastValue() - _amountAMG);
        _data.totalMintingHistory.addDataPoint(block.timestamp, _data.totalMintingHistory.lastValue() - _amountAMG);
        _cleanupSomeHistory(_data, agent);
    }

    function addFees(Data storage _data, uint256 _amount) internal {
        if (_amount == 0) return;
        uint256 epoch = currentEpoch(_data);
        ClaimEpoch storage claimEpoch = _data.epochs[epoch];
        // Is epoch initialized yet (if it is, totalFees will always be > 0, because we always add nonzero amount)?
        // Note that "gaps" between initialized epochs can occur if there are no transfers
        // (and therefore no collected fees) for more than an epoch duration; however, they are harmless.
        if (claimEpoch.totalFees == 0) {
            claimEpoch.cumulativeMinted = UNINITIALIZED;
            _expireOneClaimEpoch(_data, claimEpoch, epoch);
        }
        // add new fees to total
        claimEpoch.totalFees += _amount.toUint128();
    }

    function claimFees(Data storage _data, address _agentVault) internal returns (uint256) {
        AgentData storage agent = _data.agents[_agentVault];
        if (agent.firstUnclaimedEpoch < _data.firstClaimableEpoch) {
            agent.firstUnclaimedEpoch = _data.firstClaimableEpoch;
        }
        uint256 claimUntil = Math.min(currentEpoch(_data), agent.firstUnclaimedEpoch + MAX_SINGLE_CLAIM_EPOCHS);
        uint256 totalFees = 0;
        while (agent.firstUnclaimedEpoch < claimUntil) {
            totalFees += claimFeesForSingleEpoch(_data, agent);
        }
        return totalFees;
    }

    function claimFeesForSingleEpoch(Data storage _data, AgentData storage agent) internal returns (uint256) {
        uint256 epoch = agent.firstUnclaimedEpoch;
        assert(epoch >= _data.firstClaimableEpoch && epoch < currentEpoch(_data));
        // mark epoch claimed
        ++agent.firstUnclaimedEpoch;
        // init claim epoch
        ClaimEpoch storage claimEpoch = _data.epochs[epoch];
        if (claimEpoch.cumulativeMinted == UNINITIALIZED) {
            claimEpoch.cumulativeMinted = _epochCumulative(_data, _data.totalMintingHistory, epoch).toUint128();
        }
        // skip epochs with 0 total fees (they are just gaps when no transfers were done in whole epoch)
        if (claimEpoch.totalFees == 0) return 0;
        // calulate agent's share
        uint256 agentCumulativeMinted = _epochCumulative(_data, agent.mintingHistory, epoch);
        assert(agentCumulativeMinted <= claimEpoch.cumulativeMinted);
        if (agentCumulativeMinted == 0) return 0;
        uint256 feeShare = SafePct.mulDiv(claimEpoch.totalFees, agentCumulativeMinted, claimEpoch.cumulativeMinted);
        // remove from totals
        claimEpoch.totalFees -= feeShare.toUint128();
        claimEpoch.cumulativeMinted -= agentCumulativeMinted.toUint128();
        return feeShare;
    }

    function currentEpoch(Data storage _data) internal view returns (uint256) {
        return (block.timestamp - _data.firstEpochTimestamp) / _data.epochDuration;
    }

    function epochTimestamp(Data storage _data, uint256 _epoch) internal view returns (uint256) {
        return _data.firstEpochTimestamp + _data.epochDuration * _epoch;
    }

    function _epochCumulative(Data storage _data, TimeCumulative.Data storage _tc, uint256 _epoch)
        private view
        returns (uint256)
    {
        return _tc.intervalCumulative(epochTimestamp(_data, _epoch), epochTimestamp(_data, _epoch + 1));
    }

    function _expireOneClaimEpoch(Data storage _data, ClaimEpoch storage _claimEpoch, uint256 _currentEpoch) private {
        uint256 firstClaimableEpoch = _data.firstClaimableEpoch;
        if (firstClaimableEpoch + _data.maxUnexpiredEpochs < _currentEpoch) {
            _claimEpoch.totalFees += _data.epochs[firstClaimableEpoch].totalFees;
            delete _data.epochs[firstClaimableEpoch];
            _data.firstClaimableEpoch = uint64(firstClaimableEpoch + 1);
        }
    }

    function _cleanupSomeHistory(Data storage _data, AgentData storage _agent) private {
        uint256 cleanupBeforeTimestamp = epochTimestamp(_data, _data.firstClaimableEpoch);
        _agent.mintingHistory.cleanup(cleanupBeforeTimestamp, CLEANUP_HISTORY_POINTS);
        _data.totalMintingHistory.cleanup(cleanupBeforeTimestamp, CLEANUP_HISTORY_POINTS);
    }
}
