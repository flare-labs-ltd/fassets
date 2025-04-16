// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


library CollateralReservationInfo {
    struct Data {
        // The id used for executing or defaulting the minting.
        uint64 collateralReservationId;

        // The agent vault whose collateral is reserved.
        address agentVault;

        // The minter address - the address that will receive the minted FAssets.
        address minter;

        // The agent's underlying address to which the underlying assets should be paid by the minter.
        string paymentAddress;

        // Payment reference that must be part of the agent's redemption payment.
        bytes32 paymentReference;

        // The amount of FAssets that the minter will receive. Always a whole number of lots.
        uint256 valueUBA;

        // The underlying fee. The total amount the minter has to deposit is `valueUBA + mintingFeeUBA`.
        // Part of the fee is minted as pool fee share and the rest becomes agent's free underlying.
        uint128 mintingFeeUBA;

        // The fee that was paid at the collateral reservation time.
        // Part of the fee is goes to the pool and the rest to the agent vault as WNAT.
        uint128 reservationFeeNatWei;

        // Proportion of the mintingFeeUBA and reservationFeeNatWei that belogs to the collateral pool.
        uint16 poolFeeShareBIPS;

        // The underlying block (approximate - as known by the asset manager) when the reservation occured.
        uint64 firstUnderlyingBlock;

        // The last underlying block and timestamp for redemption payment. Redemption is defaulted if
        // there is no payment by the time BOTH lastUnderlyingBlock and lastUnderlyingTimestamp have passed.
        uint64 lastUnderlyingBlock;
        uint64 lastUnderlyingTimestamp;

        // The executor, optionally assigned by the minter to execute the minting.
        // (Only minter, agent or executor may execute the minting.)
        address executor;

        // The fee in NAT that the executor receives if they successfuly execute the minting.
        uint256 executorFeeNatWei;

        // If non-zero, the agent has started the handshake process.
        uint64 handshakeStartTimestamp;

        // Merkle root of the list of addresses from which the minter is going to deposit the underlying assets
        // (only needed when handshake is enabled for the agent).
        bytes32 sourceAddressesRoot;
    }
}
