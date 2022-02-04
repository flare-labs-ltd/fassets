// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;


interface IAssetManager {
    // subset of IAttestationClient.PaymentProof used for payment reports
    struct PaymentReport {
        bytes32 sourceAddress;
        bytes32 receivingAddress;
        bytes32 transactionHash;
        bytes32 paymentReference;
        uint256 spentAmount;
        uint256 receivedAmount;
        // TODO: also consider oneToOne flag
    }
    
    function withdrawCollateral(uint256 _valueNATWei) external;
    function destroyAgent(address _vaultAddress) external;
}
