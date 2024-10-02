// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * FAsset transfer (trailing) fees.
 */
interface ITransferFees {
    /**
     * An agent has claimed their share of transfer fees.
     */
    event TransferFeesClaimed(
        address indexed agentVault,
        address recipient,
        uint256 agentClaimedUBA,
        uint256 poolClaimedUBA,
        uint256 remainingUnclaimedEpochs);

    /**
     * Transfer fee will change at timestamp `scheduledAt`.
     */
    event TransferFeeChangeScheduled(
        uint256 nextTransferFeeMillionths,
        uint256 scheduledAt);

    /**
     * Claim FAsset transfer fees by an agent.
     * NOTE: may only be called by the agent vault owner
     * @param _agentVault the agent vault for which to claim
     * @param _recipient the account that will receive agent's share of fasset fees
     * @param _maxEpochsToClaim limit the number of epochs to claim, to avoid using too much gas
     * @return _agentClaimedUBA agent's share of total claimed amount in FAsset UBA
     * @return _poolClaimedUBA pool share of total claimed amount in FAsset UBA
     * @return _remainingUnclaimedEpochs nonzero when _maxEpochsToClaim is smaller then the number of unclaimed epochs
     */
    function claimTransferFees(address _agentVault, address _recipient, uint256 _maxEpochsToClaim)
        external
        returns (uint256 _agentClaimedUBA, uint256 _poolClaimedUBA, uint256 _remainingUnclaimedEpochs);

    function currentTransferFeeEpoch()
        external view
        returns (uint256);

    function firstClaimableTransferFeeEpoch()
        external view
        returns (uint256);

    function agentUnclaimedTransferFeeEpochs(address _agentVault)
        external view
        returns (uint256 _first, uint256 _count);

    function agentTransferFeeShare(address _agentVault, uint256 _maxEpochsToClaim)
        external view
        returns (uint256 _feeShareUBA);

    function agentTransferFeeShareForEpoch(address _agentVault, uint256 _epoch)
        external view
        returns (uint256);

    function transferFeeMillionths()
        external view
        returns (uint256);

    function setTransferFeeMillionths(uint256 _value, uint256 _scheduledAt)
        external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Internal methods

    function fassetTransferFeePaid(uint256 _fee)
        external;

    function initAgentsMintingHistory(address[] calldata _agentVaults)
        external;

    ////////////////////////////////////////////////////////////////////////////////////
    // Methods for testing and inspection

    struct TransferFeeSettings {
        uint256 transferFeeMillionths;
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
        returns (TransferFeeSettings memory);

    function transferFeeEpochData(uint256 _epoch)
        external view
        returns (TransferFeeEpochData memory);

    function transferFeeCalculationDataForAgent(address _agentVault, uint256 _epoch)
        external view
        returns (TransferFeeCalculationDataForAgent memory);
}
