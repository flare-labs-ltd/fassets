// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../data/TransferFeeTracking.sol";


contract TransferFeeTrackingMock {
    using TransferFeeTracking for TransferFeeTracking.Data;
    using TimeCumulative for TimeCumulative.Data;

    TransferFeeTracking.Data private data;

    constructor(uint64 _firstEpochStartTs, uint64 _epochDuration, uint64 _maxUnexpiredEpochs)
    {
        data.initialize(_firstEpochStartTs, _epochDuration, _maxUnexpiredEpochs);
    }

    function initMintingHistory(address _agentVault, uint64 _amountAMG) external {
        data.initMintingHistory(_agentVault, _amountAMG);
    }

    function updateMintingHistory(address _agentVault, uint64 _amountAMG) external {
        data.updateMintingHistory(_agentVault, _amountAMG);
    }

    function addFees(uint256 _amount) external {
        data.addFees(_amount);
    }

    function claimFees(address _agentVault, uint256 _maxClaimEpochs)
        external
        returns (uint256 _claimedFees, uint256 _remainingUnclaimedEpochs)
    {
        return data.claimFees(_agentVault, _maxClaimEpochs);
    }

    function calculateAgentFeeShare(address _agentVault, uint256 _maxClaimEpochs)
        external view
        returns (uint256 _claimedFees, uint256 _remainingUnclaimedEpochs)
    {
        return data.calculateAgentFeeShare(_agentVault, _maxClaimEpochs);
    }

    function currentEpoch() external view returns (uint256) {
        return data.currentEpoch();
    }

    function epochTimestamp(uint256 _epoch) external view returns (uint256) {
        return data.epochTimestamp(_epoch);
    }

    function epochClaimable(uint256 _epoch) external view returns (bool) {
        return data.epochClaimable(_epoch);
    }

    function agentFeeShare(address _agentVault, uint256 _epoch)
        external view
        returns (uint256)
    {
        return data.agentFeeShare(data.agents[_agentVault], _epoch);
    }

    struct TransferFeeSettings {
        uint256 firstEpochStartTs;
        uint256 epochDuration;
        uint256 maxUnexpiredEpochs;
        uint256 firstClaimableEpoch;
    }

    struct TransferFeeEpochData {
        uint256 startTs;
        uint256 endTs;
        uint256 totalFees;
        uint256 claimedFees;
        bool claimable;
        bool expired;
    }

    struct TransferFeeCalculationDataForAgent {
        uint256 totalFees;
        uint256 cumulativeMinted;
        uint256 totalCumulativeMinted;
        bool claimable;
        bool claimed;
    }

    function transferFeeSettings()
        external view
        returns (TransferFeeSettings memory)
    {
        return TransferFeeSettings({
            firstEpochStartTs: data.firstEpochStartTs,
            epochDuration: data.epochDuration,
            maxUnexpiredEpochs: data.maxUnexpiredEpochs,
            firstClaimableEpoch: data.firstClaimableEpoch
        });
    }

    function transferFeeEpochData(uint256 _epoch)
        external view
        returns (TransferFeeEpochData memory)
    {
        return TransferFeeEpochData({
            startTs: data.epochTimestamp(_epoch),
            endTs: data.epochTimestamp(_epoch + 1),
            totalFees: data.epochs[_epoch].totalFees,
            claimedFees: data.epochs[_epoch].claimedFees,
            claimable: data.epochClaimable(_epoch),
            expired: _epoch < data.firstClaimableEpoch
        });
    }

    function transferFeeCalculationDataForAgent(address _agentVault, uint256 _epoch)
        external view
        returns (TransferFeeCalculationDataForAgent memory)
    {
        TransferFeeTracking.AgentData storage agent = data.agents[_agentVault];
        bool claimable = data.epochClaimable(_epoch);
        return TransferFeeCalculationDataForAgent({
            totalFees: data.epochs[_epoch].totalFees,
            cumulativeMinted: data.epochCumulative(agent.mintingHistory, _epoch),
            totalCumulativeMinted: data.epochCumulative(data.totalMintingHistory, _epoch),
            claimable: claimable,
            claimed: claimable && _epoch < agent.firstUnclaimedEpoch
        });
    }

    function totalMinted() external view returns (uint256) {
        return data.totalMintingHistory.lastValue();
    }

    function agentMinted(address _agent) external view returns (uint256) {
        return data.agents[_agent].mintingHistory.lastValue();
    }
}
