// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../../userInterfaces/IAssetManager.sol";

contract MaliciousExecutor {

    address immutable public diamond;
    IReferencedPaymentNonexistence.Proof public tempProof;
    uint256 public tempRequestId;

    uint256 public hit = 0;
    uint256 public trigger = 0;

    constructor(address _diamond){
        diamond = _diamond;
    }

    function defaulting(
        IReferencedPaymentNonexistence.Proof calldata _proof,
        uint256 _redemptionRequestId,
        uint256 _trigger
    ) external{
        tempProof = _proof;
        tempRequestId = _redemptionRequestId;
        trigger = _trigger;
        IAssetManager(diamond).redemptionPaymentDefault(
            _proof,
            _redemptionRequestId
        );
    }

    function howMuchIsMyNativeBalance() external view returns(uint256){
        return address(this).balance;
    }

    fallback() external payable {
        if( hit == 0 && trigger == 1){
            hit = 1;
            IAssetManager(diamond).redemptionPaymentDefault(
                tempProof,
                tempRequestId
            );
            hit = 0;
        }
    }
}