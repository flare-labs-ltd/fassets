// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./AssetManagerBase.sol";
import "../../diamond/facets/GovernedFacet.sol";
import "../../diamond/library/LibDiamond.sol";
import "../../userInterfaces/IAssetManagerEvents.sol";
import "../../userInterfaces/ITransferFees.sol";
import "../../utils/lib/SafePct.sol";
import "../library/SettingsUpdater.sol";
import "../library/data/TransferFeeTracking.sol";
import "../library/TransferFees.sol";
import "../library/Agents.sol";


contract TransferFeeFacet is AssetManagerBase, GovernedFacet, IAssetManagerEvents, ITransferFees {
    using TransferFeeTracking for TransferFeeTracking.Data;
    using SafeCast for *;

    modifier onlyAgentVaultOwner(address _agentVault) {
        Agents.requireAgentVaultOwner(_agentVault);
        _;
    }

    modifier onlyFAsset {
        AssetManagerSettings.Data storage settings = Globals.getSettings();
        require(msg.sender == settings.fAsset, "only FAsset");
        _;
    }

    /**
     * @dev This method is not accessible through diamond proxy,
     * it is only used for initialization when the contract is added after proxy deploy.
     */
    function initTransferFeeFacet(
        uint256 _transferFeeMillionths,
        uint256 _firstEpochStartTs,
        uint256 _epochDuration,
        uint256 _maxUnexpiredEpochs
    )
        external
    {
        LibDiamond.DiamondStorage storage ds = LibDiamond.diamondStorage();
        require(ds.supportedInterfaces[type(IERC165).interfaceId], "diamond not initialized");
        ds.supportedInterfaces[type(IRedemptionTimeExtension).interfaceId] = true;
        // init settings
        TransferFees.State storage state = TransferFees.getState();
        TransferFeeTracking.Data storage data = state.transferFeeTracking;
        require(_transferFeeMillionths <= 1e6, "millionths value too high");
        state.transferFeeMillionths = _transferFeeMillionths.toUint32();
        data.initialize(_firstEpochStartTs.toUint64(), _epochDuration.toUint64(), _maxUnexpiredEpochs.toUint64());
    }

    /**
     * This method is only needed if this facet was deployed by diamond cut when some agents already
     * back nonzero minting.
     * This method is no-op if the agent already has some history checkpoints or it has 0 minting,
     * so it is safe to be called by anybody. E.g. it won't do anything unless it is called after a dimanod cut with
     * some agents already backing some mintings and it will do nothing when called the second time on the same agent.
     * If this method is not called, the agents will be automatically initialized on first minting or redemption,
     * but they may miss out on some tracking fees for the duration between the diamond cut and the first
     * subsequent minting or redemption.
     * @param _agentVaults the agent vaults to be initialized; the caller should make a snapshot array of all
     * agents' addresses before the diamond cut and then call this method with suitably sized chunks of that array
     */
    function initAgentsMintingHistory(address[] calldata _agentVaults)
        external
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        for (uint256 i = 0; i < _agentVaults.length; i++) {
            Agent.State storage agent = Agent.get(_agentVaults[i]);
            if (agent.mintedAMG > 0) {
                data.initMintingHistory(_agentVaults[i], agent.mintedAMG);
            }
        }
    }

    function setTransferFeeMillionths(uint256 _value)
        external
        onlyImmediateGovernance
    {
        SettingsUpdater.checkEnoughTimeSinceLastUpdate(keccak256("TransferFeeFacet.setTransferFeeMillionths"));
        TransferFees.State storage state = TransferFees.getState();
        // validate
        uint256 currentValue = state.transferFeeMillionths;
        require(_value <= currentValue * 4 + 1000, "increase too big");
        require(_value >= currentValue / 4, "decrease too big");
        // update
        state.transferFeeMillionths = _value.toUint32();
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
        TransferFees.State storage state = TransferFees.getState();
        return state.transferFeeMillionths;
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

    function transferFeeClaimingSettings()
        external view
        returns(
            uint256 _firstEpochStartTs,
            uint256 _epochDuration,
            uint256 _maxUnexpiredEpochs,
            uint256 _firstClaimableEpoch
        )
    {
        TransferFeeTracking.Data storage data = _getTransferFeeData();
        _firstEpochStartTs = data.firstEpochStartTs;
        _epochDuration = data.epochDuration;
        _maxUnexpiredEpochs = data.maxUnexpiredEpochs;
        _firstClaimableEpoch = data.firstClaimableEpoch;
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
        TransferFees.State storage state = TransferFees.getState();
        return state.transferFeeTracking;
    }
}
