// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;


library CollateralReservation {
    struct Data {
        uint64 valueAMG;
        uint64 firstUnderlyingBlock;
        uint64 lastUnderlyingBlock;
        uint64 lastUnderlyingTimestamp;
        uint128 underlyingFeeUBA;
        uint128 reservationFeeNatWei;
        address agentVault;
        address minter;
        address payable executor;
        uint64 executorFeeNatGWei;
    }
}
