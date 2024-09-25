// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "./AssetManagerBase.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "../../utils/lib/SafePct.sol";
import "../library/data/TransferFeeTracking.sol";
import "../library/Agents.sol";


contract TransferFeeFacet is AssetManagerBase, IAssetManagerEvents {
    using TransferFeeTracking for TransferFeeTracking.Data;

    modifier onlyAgentVaultOwner(address _agentVault) {
        Agents.requireAgentVaultOwner(_agentVault);
        _;
    }

    modifier onlyFAsset {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        require(msg.sender == settings.fAsset, "only FAsset");
        _;
    }

    function claimTransferFees(address _agentVault, address _recipient, uint256 _maxEpochsToClaim)
        external
        onlyAgentVaultOwner(_agentVault)
        returns (uint256 _claimedAmountUBA, uint256 _remainingUnclaimedEpochs)
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        (_claimedAmountUBA, _remainingUnclaimedEpochs) = data.claimFees(_agentVault, _maxEpochsToClaim);
        Globals.getFAsset().transferInternally(_recipient, _claimedAmountUBA);
        emit TransferFeesClaimed(_agentVault, _recipient, _claimedAmountUBA, _remainingUnclaimedEpochs);
    }

    function fassetTransferFeePaid(uint256 _fee)
        external
        onlyFAsset
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        data.addFees(_fee);
    }

    function fassetFeeForTransfer(uint256 _transferAmount)
        external view
        returns (uint256 _transferAmountUBA)
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        return SafePct.mulDiv(_transferAmount, settings.transferFeeMillionths, 1000000);
    }

    // information methods

    function currentTransferFeeEpoch()
        external view
        returns (uint256)
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        return data.currentEpoch();
    }

    function firstClaimableTransferFeeEpoch()
        external view
        returns (uint256)
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        return data.firstClaimableEpoch;
    }

    function agentUnclaimedTransferFeeEpochs(address _agentVault)
        external view
        returns (uint256 _first, uint256 _count)
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        TransferFeeTracking.AgentData storage agent = data.agents[_agentVault];
        _first = Math.max(agent.firstUnclaimedEpoch, data.firstClaimableEpoch);
        _count = data.currentEpoch() - _first;
    }

    function agentTransferFeeShare(address _agentVault, uint256 _maxEpochsToClaim)
        external view
        returns (uint256 _feeShareUBA, uint256 _remainingUnclaimedEpochs)
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        return data.calculateAgentFeeShare(_agentVault, _maxEpochsToClaim);
    }

    function agentTransferFeeShareForEpoch(address _agentVault, uint256 _epoch)
        external view
        returns (uint256)
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        TransferFeeTracking.AgentData storage agent = data.agents[_agentVault];
        bool claimable = data.epochClaimable(_epoch) && _epoch >= agent.firstUnclaimedEpoch;
        return claimable ? data.agentFeeShare(agent, _epoch) : 0;
    }

    function transferFeeEpochData(uint256 _epoch)
        external view
        returns (
            uint256 _startTs,
            uint256 _endTs,
            uint256 _totalFees,
            uint256 _claimedFees,
            bool _claimable,
            bool _expired
        )
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        _startTs = data.epochTimestamp(_epoch);
        _endTs = data.epochTimestamp(_epoch + 1);
        _totalFees = data.epochs[_epoch].totalFees;
        _claimedFees = data.epochs[_epoch].claimedFees;
        _claimable = data.epochClaimable(_epoch);
        _expired = _epoch < data.firstClaimableEpoch;
    }

    function agentTransferFeeEpochData(address _agentVault, uint256 _epoch)
        external view
        returns (
            uint256 _totalFees,
            uint256 _cumulativeMinted,
            uint256 _totalCumulativeMinted,
            bool _claimable,
            bool _claimed
        )
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        TransferFeeTracking.AgentData storage agent = data.agents[_agentVault];
        _totalFees = data.epochs[_epoch].totalFees;
        _cumulativeMinted = data.epochCumulative(agent.mintingHistory, _epoch);
        _totalCumulativeMinted = data.epochCumulative(data.totalMintingHistory, _epoch);
        _claimable = data.epochClaimable(_epoch);
        _claimed = _claimable && _epoch < agent.firstUnclaimedEpoch;
    }

    function _getTransferFeeData() private view returns (TransferFeeTracking.Data storage) {
        AssetManagerState.State storage state = AssetManagerState.get();
        return state.transferFeeTracking;
    }
}
