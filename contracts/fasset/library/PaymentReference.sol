// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;


library PaymentReference {
    // 0x7958d5b6aa3dfe33 = uint64(keccak256("f-asset minting payment"))
    uint256 internal constant MINTING = 0x7958d5b6aa3dfe33 << 192;
        
    // 0x2e700e07b6642eaa = uint64(keccak256("f-asset redemption payment"))
    uint256 internal constant REDEMPTION = 0x2e700e07b6642eaa << 192;

    //  0xd52a7a170c97df29 = uint64(keccak256("f-asset underlying address topup"))
    uint256 internal constant TOPUP = 0xd52a7a170c97df29 << 192;

    // 0x7825d1a0b3e07380 = uint64(keccak256("f-asset self-mint payment"))
    uint256 internal constant SELF_MINT = 0x7825d1a0b3e07380 << 192;

    // 0x238df6e106ee985a = uint64(keccak256("f-asset announced underlying withdrawal"))
    uint256 internal constant ANNOUNCED_WITHDRAWAL = 0x238df6e106ee985a << 192;
    
    // 0x7bd3bf51c3e904c3 = uint64(keccak256("f-asset address ownership"))
    uint256 internal constant ADDRESS_OWNERSHIP = 0x7bd3bf51c3e904c3 << 192;

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
            
    function verify(uint256 _type, uint256 _reference) internal pure returns (bool) {
        return (_reference & _type) == _type;
    }
    
    function requireType(uint256 _type, uint256 _reference) internal pure {
        require((_reference & _type) == _type, "invalid payment reference");
    }
    
    function decodeId(uint256 _reference) internal pure returns (uint64) {
        return uint64(_reference & ((1 << 64) - 1));
    }
}
