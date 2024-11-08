// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

/**
 * Relay interface.
 */
interface IRelay {

    struct FeeConfig {
        uint8 protocolId;   // Protocol id for which the fee is set
        uint256 feeInWei;   // Fee in wei
    }

    struct RelayInitialConfig {
        uint32 initialRewardEpochId;                           // The initial reward epoch id.
        uint32 startingVotingRoundIdForInitialRewardEpochId;   // The starting voting round id for the initial
                                                               // reward epoch.
        bytes32 initialSigningPolicyHash;                      // The initial signing policy hash.
        uint8 randomNumberProtocolId;                          // The protocol id of the random number protocol.
        uint32 firstVotingRoundStartTs;                        // The timestamp of the first voting round start.
        uint8 votingEpochDurationSeconds;                      // The duration of a voting epoch in seconds.
        uint32 firstRewardEpochStartVotingRoundId;             // The start voting round id of the first reward epoch.
        uint16 rewardEpochDurationInVotingEpochs;              // The duration of a reward epoch in voting epochs.
        uint16 thresholdIncreaseBIPS;                          // The threshold increase in BIPS for signing with
                                                               // old signing policy.
        uint32 messageFinalizationWindowInRewardEpochs;        // The window of reward epochs for finalizing
                                                               // the protocol messages.
        address payable feeCollectionAddress;                  // Fee collection address
        FeeConfig[] feeConfigs;                                // Fee configurations
    }

    struct RelayGovernanceConfig {
        bytes32 descriptionHash;        // Description hash (should be keccak256("RelayGovernance")
        uint256 chainId;                // Chain id on which is the relay is deployed
        FeeConfig[] newFeeConfigs;      // Fee configurations
    }

    // Event is emitted when a new signing policy is initialized by the signing policy setter.
    event SigningPolicyInitialized(
        uint24 indexed rewardEpochId,   // Reward epoch id
        uint32 startVotingRoundId,      // First voting round id of validity.
                                        // Usually it is the first voting round of reward epoch rewardEpochId.
                                        // It can be later,
                                        // if the confirmation of the signing policy on Flare blockchain gets delayed.
        uint16 threshold,               // Confirmation threshold (absolute value of noramalised weights).
        uint256 seed,                   // Random seed.
        address[] voters,               // The list of eligible voters in the canonical order.
        uint16[] weights,               // The corresponding list of normalised signing weights of eligible voters.
                                        // Normalisation is done by compressing the weights from 32-byte values to
                                        // 2 bytes, while approximately keeping the weight relations.
        bytes signingPolicyBytes,       // The full signing policy byte encoded.
        uint64 timestamp                // Timestamp when this happened
    );

    // Event is emitted when a signing policy is relayed.
    // It contains minimalistic data in order to save gas. Data about the signing policy are
    // extractable from the calldata, assuming prefered usage of direct top-level call to relay().
    event SigningPolicyRelayed(
        uint256 indexed rewardEpochId        // Reward epoch id
    );

    // Event is emitted when a protocol message is relayed.
    event ProtocolMessageRelayed(
        uint8 indexed protocolId,           // Protocol id
        uint32 indexed votingRoundId,       // Voting round id
        bool isSecureRandom,                // Secure random flag
        bytes32 merkleRoot                  // Merkle root of the protocol message
    );

    /**
     * Checks the relay message for sufficient weight of signatures for the _messageHash
     * signed for protocol message Merkle root of the form (1, 0, 0, _messageHash).
     * If the check is successful, reward epoch id of the signing policy is returned.
     * Otherwise the function reverts.
     * @param _relayMessage The relay message.
     * @param _messageHash The hash of the message.
     * @return _rewardEpochId The reward epoch id of the signing policy.
     */
    function verifyCustomSignature(
        bytes calldata _relayMessage,
        bytes32 _messageHash
    )
        external
        returns (uint256 _rewardEpochId);

    /**
     * Checks the relay message for sufficient weight of signatures of the hash of the _config data.
     * If the check is successful, the relay contract is configured with the new _config data, which
     * in particular means that fee configurations are updated.
     * Otherwise the function reverts.
     * @param _relayMessage The relay message.
     * @param _config The new relay configuration.
     */
    function governanceFeeSetup(bytes calldata _relayMessage, RelayGovernanceConfig calldata _config) external;

    /**
     * Finalization function for new signing policies and protocol messages.
     * It can be used as finalization contract on Flare chain or as relay contract on other EVM chain.
     * Can be called in two modes. It expects calldata that is parsed in a custom manner.
     * Hence the transaction calls should assemble relevant calldata in the 'data' field.
     * Depending on the data provided, the contract operations in essentially two modes:
     * (1) Relaying signing policy. The structure of the calldata is:
     *        function signature (4 bytes) + active signing policy
     *             + 0 (1 byte) + new signing policy,
     *     total of exactly 4423 bytes.
     * (2) Relaying signed message. The structure of the calldata is:
     *        function signature (4 bytes) + signing policy
     *           + signed message (38 bytes) + ECDSA signatures with indices (67 bytes each)
     *     This case splits into two subcases:
     *     - protocolMessageId = 1: Message id must be of the form (protocolMessageId, 0, 0, merkleRoot).
     *       The validity of the signatures of sufficient weight is checked and if
     *       successful, the merkleRoot from the message is returned (32 bytes) and the
     *       reward epoch id of the signing policy as well (additional 3 bytes)
     *     - protocolMessageId > 1: The validity of the signatures of sufficient weight is checked and if
     *       it is valid, the merkleRoot is published for protocolId and votingRoundId.
     * Reverts if relaying is not successful.
     */
    function relay() external returns (bytes memory);

    /**
     * Verifies the leaf (or intermediate node) with the Merkle proof against the Merkle root
     * for given protocol id and voting round id.
     * A fee may need to be paid. It is protocol specific.
     * **NOTE:** Overpayment is not refunded.
     * @param _protocolId The protocol id.
     * @param _votingRoundId The voting round id.
     * @param _leaf The leaf (or intermediate node) to verify.
     * @param _proof The Merkle proof.
     * @return True if the verification is successful.
     */
    function verify(uint256 _protocolId, uint256 _votingRoundId, bytes32 _leaf, bytes32[] calldata _proof)
        external payable
        returns (bool);

    /**
     * Returns the signing policy hash for given reward epoch id.
     * The function is reverted if signingPolicySetter is set, hence on all
     * deployments where the contract is used as a pure relay.
     * @param _rewardEpochId The reward epoch id.
     * @return _signingPolicyHash The signing policy hash.
     */
    function toSigningPolicyHash(uint256 _rewardEpochId) external view returns (bytes32 _signingPolicyHash);

    /**
     * Returns true if there is finalization for a given protocol id and voting round id.
     * @param _protocolId The protocol id.
     * @param _votingRoundId The voting round id.
     */
    function isFinalized(uint256 _protocolId, uint256 _votingRoundId) external view returns (bool);

    /**
     * Returns the Merkle root for given protocol id and voting round id.
     * The function is reverted if signingPolicySetter is set, hence on all
     * deployments where the contract is used as a pure relay.
     * @param _protocolId The protocol id.
     * @param _votingRoundId The voting round id.
     * @return _merkleRoot The Merkle root.
     */
    function merkleRoots(uint256 _protocolId, uint256 _votingRoundId) external view returns (bytes32 _merkleRoot);

    /**
     * Returns the start voting round id for given reward epoch id.
     * @param _rewardEpochId The reward epoch id.
     * @return _startingVotingRoundId The start voting round id.
     */
    function startingVotingRoundIds(uint256 _rewardEpochId) external view returns (uint256 _startingVotingRoundId);

    /**
     * Returns the voting round id for given timestamp.
     * @param _timestamp The timestamp.
     * @return _votingRoundId The voting round id.
     */
    function getVotingRoundId(uint256 _timestamp) external view returns (uint256 _votingRoundId);

    /**
     * Returns last initialized reward epoch data.
     * @return _lastInitializedRewardEpoch Last initialized reward epoch.
     * @return _startingVotingRoundIdForLastInitializedRewardEpoch Starting voting round id for it.
     */
    function lastInitializedRewardEpochData()
        external view
        returns (
            uint32 _lastInitializedRewardEpoch,
            uint32 _startingVotingRoundIdForLastInitializedRewardEpoch
        );

    /**
     * Returns fee collection address.
     */
    function feeCollectionAddress() external view returns (address payable);

    /**
     * Returns fee in wei for one verification of a given protocol id.
     * @param _protocolId The protocol id.
     */
    function protocolFeeInWei(uint256 _protocolId) external view returns (uint256);

}
