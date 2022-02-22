// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;


library PaymentReference {
    uint256 private constant TYPE_SHIFT = 192;
    
    // 0x7958d5b6aa3dfe33 = uint64(keccak256("f-asset minting payment"))
    uint256 internal constant MINTING = 0x7958d5b6aa3dfe33 << TYPE_SHIFT;
        
    // 0x2e700e07b6642eaa = uint64(keccak256("f-asset redemption payment"))
    uint256 internal constant REDEMPTION = 0x2e700e07b6642eaa << TYPE_SHIFT;

    //  0xd52a7a170c97df29 = uint64(keccak256("f-asset underlying address topup"))
    uint256 internal constant TOPUP = 0xd52a7a170c97df29 << TYPE_SHIFT;

    // 0x7825d1a0b3e07380 = uint64(keccak256("f-asset self-mint payment"))
    uint256 internal constant SELF_MINT = 0x7825d1a0b3e07380 << TYPE_SHIFT;

    // 0x238df6e106ee985a = uint64(keccak256("f-asset announced underlying withdrawal"))
    uint256 internal constant ANNOUNCED_WITHDRAWAL = 0x238df6e106ee985a << TYPE_SHIFT;
    
    // 0x7bd3bf51c3e904c3 = uint64(keccak256("f-asset address ownership"))
    uint256 internal constant ADDRESS_OWNERSHIP = 0x7bd3bf51c3e904c3 << TYPE_SHIFT;

    // create various payment references
            
    function minting(uint64 _id) internal pure returns (uint256) {
        return uint256(_id) | MINTING;
    }

    function redemption(uint64 _id) internal pure returns (uint256) {
        return uint256(_id) | REDEMPTION;
    }

    function announcedWithdrawal(uint64 _id) internal pure returns (uint256) {
        return uint256(_id) | ANNOUNCED_WITHDRAWAL;
    }

    function addressTopup(address _agentVault) internal pure returns (uint256) {
        return uint256(uint160(_agentVault)) | TOPUP;
    }

    function selfMint(address _agentVault) internal pure returns (uint256) {
        return uint256(uint160(_agentVault)) | SELF_MINT;
    }
    
    function addressOwnership(address _agentVault) internal pure returns (uint256) {
        return uint256(uint160(_agentVault)) | ADDRESS_OWNERSHIP;
    }
    
    // verify and decode payment references
            
    function isValid(uint256 _reference, uint256 _type) internal pure returns (bool) {
        uint256 refType = _reference & _type;
        uint256 refLowBits = _reference & ((1 << TYPE_SHIFT) - 1);
        // for valid reference, type must match and low bits may never be 0 (are either id or address)
        return refType == _type && refLowBits != 0;
    }
    
    function requireType(uint256 _type, uint256 _reference) internal pure {
        require((_reference & _type) == _type, "invalid payment reference");
    }
    
    function decodeId(uint256 _reference) internal pure returns (uint64) {
        return uint64(_reference & ((1 << 64) - 1));
    }
}
