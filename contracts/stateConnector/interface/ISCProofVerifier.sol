//////////////////////////////////////////////////////////////
// This file is auto generated. Do not edit.
//////////////////////////////////////////////////////////////

// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

import "state-connector-protocol/contracts/interface/types/Payment.sol";
import "state-connector-protocol/contracts/interface/types/ReferencedPaymentNonexistence.sol";
import "state-connector-protocol/contracts/interface/types/BalanceDecreasingTransaction.sol";
import "state-connector-protocol/contracts/interface/types/ConfirmedBlockHeightExists.sol";


interface ISCProofVerifier {
    function verifyPayment(Payment.Proof calldata _proof)
        external view
        returns (bool _proved);

    function verifyBalanceDecreasingTransaction(BalanceDecreasingTransaction.Proof calldata _proof)
        external view
        returns (bool _proved);

    function verifyReferencedPaymentNonexistence(ReferencedPaymentNonexistence.Proof calldata _proof)
        external view
        returns (bool _proved);

    function verifyConfirmedBlockHeightExists(ConfirmedBlockHeightExists.Proof calldata _proof)
        external view
        returns (bool _proved);
}
