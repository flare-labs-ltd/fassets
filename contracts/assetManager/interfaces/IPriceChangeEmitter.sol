// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

interface IPriceChangeEmitter {
    /**
     * Emitted by FtsoManager when the price epoch is finalized, therefore the new prices are ready to be used.
     * Parameters are not used and are only there for FtsoManager compatibility.
     */
    event PriceEpochFinalized(address, uint256);

    /**
     * Emitted by FtsoV2PriceStore when the price epoch is finalized, therefore the new prices are ready to be used.
     */
    event PricesPublished(uint32 indexed votingRoundId);
}
