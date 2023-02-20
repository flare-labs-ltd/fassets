// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

library Redemption {
    enum Status {
        EMPTY,
        ACTIVE,
        DEFAULTED
    }

    struct Request {
        bytes32 redeemerUnderlyingAddressHash;
        uint128 underlyingValueUBA;
        uint128 underlyingFeeUBA;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
        uint64 lastUnderlyingTimestamp;
        uint64 valueAMG;
        address redeemer;
        uint64 timestamp;
        address agentVault;
        Redemption.Status status;
    }
}
