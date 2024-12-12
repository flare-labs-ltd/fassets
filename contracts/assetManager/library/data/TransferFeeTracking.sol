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
        uint128 claimedFees;
    }

    struct Data {
        TimeCumulative.Data totalMintingHistory;

        // claim epochs data
        mapping(uint256 => ClaimEpoch) epochs;
        uint64 firstEpochStartTs;
        uint64 epochDuration;
        uint64 maxUnexpiredEpochs;
        uint64 firstClaimableEpoch;

        // per agent data
        mapping(address agentVault => AgentData) agents;
    }

    uint256 internal constant CLEANUP_HISTORY_POINTS = 2;

    function initialize(
        Data storage _data,
        uint64 _firstEpochStartTs,
        uint64 _epochDuration,
        uint64 _maxUnexpiredEpochs
    )
        internal
    {
        require(_data.epochDuration == 0, "already initialized");
        require(_epochDuration > 0, "epoch duration must be nonzero");
        _data.firstEpochStartTs = _firstEpochStartTs;
        _data.epochDuration = _epochDuration;
        _data.maxUnexpiredEpochs = _maxUnexpiredEpochs;
        // allow initial settings to set first epoch start to any past date,
        // without forcing users to skip hundreds of empty epochs during claiming
        _data.firstClaimableEpoch = currentEpoch(_data).toUint64();
    }

    /**
     * Add a checkpoint to agent if its minting history is empty.
     * Only needed if the history tracking is added when the agents already have nonzero minting
     * (e.g. if this lib is deployed by diamond cut), since "no checkpoint in the past" is equivalent
     * to a checkpoint with zero value.
     */
    function initMintingHistory(Data storage _data, address _agentVault, uint64 _amountAMG) internal {
        AgentData storage agent = _data.agents[_agentVault];
        if (agent.mintingHistory.endIndex == 0) {
            updateMintingHistory(_data, _agentVault, _amountAMG);
        }
    }

    /**
     * Create a new checkpoint for the agent and the total (or update the last one if the timestamp didn't
     * change since the last checkpoint was created).
     */
    function updateMintingHistory(Data storage _data, address _agentVault, uint64 _amountAMG) internal {
        AgentData storage agent = _data.agents[_agentVault];
        uint64 prevAmount = agent.mintingHistory.lastValue();
        uint64 prevTotal = _data.totalMintingHistory.lastValue();
        agent.mintingHistory.addDataPoint(block.timestamp, _amountAMG);
        _data.totalMintingHistory.addDataPoint(block.timestamp, prevTotal + _amountAMG - prevAmount);
        _cleanupSomeHistory(_data, agent);
    }

    function addFees(Data storage _data, uint256 _amount) internal {
        uint256 epoch = currentEpoch(_data);
        // if an epoch is expired, delete the data and transfer all fees to current epoch
        _cleanupOneExpiredEpoch(_data, epoch);
        // add new fees to total
        _data.epochs[epoch].totalFees += _amount.toUint128();
    }

    function claimFees(Data storage _data, address _agentVault, uint256 _maxClaimEpochs)
        internal
        returns (uint256 _claimedFees, uint256 _remainingUnclaimedEpochs)
    {
        AgentData storage agent = _data.agents[_agentVault];
        uint256 currentEpochNo = currentEpoch(_data);
        uint256 firstUnclaimedEpoch = Math.max(agent.firstUnclaimedEpoch, _data.firstClaimableEpoch);
        uint256 claimUntilEpoch = Math.min(currentEpochNo, firstUnclaimedEpoch + _maxClaimEpochs);
        _claimedFees = 0;
        for (uint256 epoch = firstUnclaimedEpoch; epoch < claimUntilEpoch; epoch++) {
            uint256 feeShare = agentFeeShare(_data, agent, epoch);
            _claimedFees += feeShare;
            _data.epochs[epoch].claimedFees += feeShare.toUint128();
        }
        agent.firstUnclaimedEpoch = claimUntilEpoch.toUint64();
        _remainingUnclaimedEpochs = currentEpochNo - claimUntilEpoch;
    }

    function calculateAgentFeeShare(Data storage _data, address _agentVault, uint256 _maxClaimEpochs)
        internal view
        returns (uint256 _claimedFees, uint256 _remainingUnclaimedEpochs)
    {
        AgentData storage agent = _data.agents[_agentVault];
        uint256 currentEpochNo = currentEpoch(_data);
        uint256 firstUnclaimedEpoch = Math.max(agent.firstUnclaimedEpoch, _data.firstClaimableEpoch);
        uint256 claimUntilEpoch = Math.min(currentEpochNo, firstUnclaimedEpoch + _maxClaimEpochs);
        _claimedFees = 0;
        for (uint256 epoch = firstUnclaimedEpoch; epoch < claimUntilEpoch; epoch++) {
            _claimedFees += agentFeeShare(_data, agent, epoch);
        }
        _remainingUnclaimedEpochs = currentEpochNo - claimUntilEpoch;
    }

    function currentEpoch(Data storage _data) internal view returns (uint256) {
        return (block.timestamp - _data.firstEpochStartTs) / _data.epochDuration;
    }

    function epochTimestamp(Data storage _data, uint256 _epoch) internal view returns (uint256) {
        return _data.firstEpochStartTs + _data.epochDuration * _epoch;
    }

    function epochClaimable(Data storage _data, uint256 _epoch) internal view returns (bool) {
        return _epoch >= _data.firstClaimableEpoch && _epoch < currentEpoch(_data);
    }

    function agentFeeShare(Data storage _data, AgentData storage _agent, uint256 _epoch)
        internal view
        returns (uint256)
    {
        ClaimEpoch storage claimEpoch = _data.epochs[_epoch];
        uint256 agentCumulativeMinted = epochCumulative(_data, _agent.mintingHistory, _epoch);
        uint256 totalCumulativeMinted = epochCumulative(_data, _data.totalMintingHistory, _epoch);
        assert(agentCumulativeMinted <= totalCumulativeMinted);
        if (agentCumulativeMinted == 0) return 0;
        return SafePct.mulDiv(claimEpoch.totalFees, agentCumulativeMinted, totalCumulativeMinted);
    }

    function epochCumulative(Data storage _data, TimeCumulative.Data storage _tc, uint256 _epoch)
        internal view
        returns (uint256)
    {
        return _tc.intervalCumulative(epochTimestamp(_data, _epoch), epochTimestamp(_data, _epoch + 1));
    }

    function _cleanupOneExpiredEpoch(Data storage _data, uint256 _currentEpoch) private {
        uint256 firstClaimableEpoch = _data.firstClaimableEpoch;
        if (firstClaimableEpoch + _data.maxUnexpiredEpochs < _currentEpoch) {
            ClaimEpoch storage expiringEpoch = _data.epochs[firstClaimableEpoch];
            // transfer remaining fees to the current epoch
            _data.epochs[_currentEpoch].totalFees += expiringEpoch.totalFees - expiringEpoch.claimedFees;
            // cleanup epoch data
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
