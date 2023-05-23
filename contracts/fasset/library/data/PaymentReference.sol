// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;


library PaymentReference {
    uint256 private constant TYPE_SHIFT = 192;
    uint256 private constant TYPE_MASK = ((1 << 64) - 1) << TYPE_SHIFT;
    uint256 private constant LOW_BITS_MASK = (1 << TYPE_SHIFT) - 1;
    uint256 private constant ID_RANDOMIZATION = 1000;

    // common prefix 0x464250526641 = hex('FBPRfA' - Flare Bridge Payment Reference / fAsset)

    uint256 internal constant MINTING = 0x4642505266410001 << TYPE_SHIFT;
    uint256 internal constant REDEMPTION = 0x4642505266410002 << TYPE_SHIFT;
    uint256 internal constant ANNOUNCED_WITHDRAWAL = 0x4642505266410003 << TYPE_SHIFT;
    uint256 internal constant TOPUP = 0x4642505266410011 << TYPE_SHIFT;
    uint256 internal constant SELF_MINT = 0x4642505266410012 << TYPE_SHIFT;
    uint256 internal constant ADDRESS_OWNERSHIP = 0x4642505266410013 << TYPE_SHIFT;

    // create various payment references

    function minting(uint64 _id) internal pure returns (bytes32) {
        return bytes32(uint256(_id) | MINTING);
    }

    function redemption(uint64 _id) internal pure returns (bytes32) {
        return bytes32(uint256(_id) | REDEMPTION);
    }

    function announcedWithdrawal(uint64 _id) internal pure returns (bytes32) {
        return bytes32(uint256(_id) | ANNOUNCED_WITHDRAWAL);
    }

    function topup(address _agentVault) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_agentVault)) | TOPUP);
    }

    function selfMint(address _agentVault) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_agentVault)) | SELF_MINT);
    }

    function addressOwnership(address _agentVault) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(_agentVault)) | ADDRESS_OWNERSHIP);
    }

    // verify and decode payment references

    function isValid(bytes32 _reference, uint256 _type) internal pure returns (bool) {
        uint256 refType = uint256(_reference) & TYPE_MASK;
        uint256 refLowBits = uint256(_reference) & LOW_BITS_MASK;
        // for valid reference, type must match and low bits may never be 0 (are either id or address)
        return refType == _type && refLowBits != 0;
    }

    function decodeId(bytes32 _reference) internal pure returns (uint256) {
        return uint256(_reference) & LOW_BITS_MASK;
    }

    function randomizedIdSkip() internal view returns (uint64) {
        // This is rather weak randomization, but it's ok for the purpose of preventing speculative underlying
        // payments, since there is only one guess possible - the first mistake makes agent liquidated.
        //slither-disable-next-line weak-prng
        return uint64(block.number % ID_RANDOMIZATION + 1);
    }
}
