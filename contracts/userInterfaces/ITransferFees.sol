// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


/**
 * FAsset transfer (trailing) fees.
 */
interface ITransferFees {
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

    function setTransferFeeMillionths(uint256 _value)
        external;

    function transferFeeClaimingSettings()
        external view
        returns(
            uint256 _firstEpochStartTs,
            uint256 _epochDuration,
            uint256 _maxUnexpiredEpochs,
            uint256 _firstClaimableEpoch
        );

    ////////////////////////////////////////////////////////////////////////////////////
    // Internal methods

    function fassetTransferFeePaid(uint256 _fee)
        external;

    function initAgentsMintingHistory(address[] calldata _agentVaults)
        external;

    function transferFeeEpochData(uint256 _epoch)
        external view
        returns (
            uint256 _startTs,
            uint256 _endTs,
            uint256 _totalFees,
            uint256 _claimedFees,
            bool _claimable,
            bool _expired
        );

    function agentTransferFeeEpochData(address _agentVault, uint256 _epoch)
        external view
        returns (
            uint256 _totalFees,
            uint256 _cumulativeMinted,
            uint256 _totalCumulativeMinted,
            bool _claimable,
            bool _claimed
        );
}
