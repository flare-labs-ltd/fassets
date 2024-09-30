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

    function setTransferFeeMillionths(uint256 _value)
        external
        onlyAssetManagerController
        rateLimited
    {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        // validate
        uint256 currentValue = settings.transferFeeMillionths;
        require(_value <= currentValue * 4 + 1000, "increase too big");
        require(_value >= currentValue / 4, "decrease too big");
        // update
        settings.transferFeeMillionths = _value.toUint32();
        emit SettingChanged("transferFeeMillionths", _value);
    }

    function claimTransferFees(address _agentVault, address _recipient, uint256 _maxEpochsToClaim)
        external
        onlyAgentVaultOwner(_agentVault)
        returns (uint256 _agentClaimedUBA, uint256 _poolClaimedUBA, uint256 _remainingUnclaimedEpochs)
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        (uint256 claimedUBA, uint256 unclaimedEpochs) = data.claimFees(_agentVault, _maxEpochsToClaim);
        Agent.State storage agent = Agent.get(_agentVault);
        IIFAsset fAsset = Globals.getFAsset();
        _poolClaimedUBA = SafePct.mulBips(claimedUBA, agent.poolFeeShareBIPS);
        _agentClaimedUBA = claimedUBA - _poolClaimedUBA;
        _remainingUnclaimedEpochs = unclaimedEpochs;
        fAsset.transferInternally(_recipient, _agentClaimedUBA);
        fAsset.transferInternally(address(agent.collateralPool), _poolClaimedUBA);
        agent.collateralPool.fAssetFeeDeposited(_poolClaimedUBA);
        emit TransferFeesClaimed(_agentVault, _recipient, _agentClaimedUBA, _poolClaimedUBA, unclaimedEpochs);
    }

    function fassetTransferFeePaid(uint256 _fee)
        external
        onlyFAsset
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        data.addFees(_fee);
    }

    function transferFeeMillionths()
        external view
        returns (uint256)
    {
        return Globals.getSettings().transferFeeMillionths;
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
        returns (uint256 _feeShareUBA)
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        (_feeShareUBA,) = data.calculateAgentFeeShare(_agentVault, _maxEpochsToClaim);
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
