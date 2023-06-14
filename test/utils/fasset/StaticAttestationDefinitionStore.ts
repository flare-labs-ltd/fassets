import Web3 from "web3";
import { AttestationDefinitionStore } from "../../../lib/verification/attestation-types/AttestationDefinitionStore";
import { TDEF as paymentDef } from "../../../lib/verification/attestation-types/t-00001-payment";
import { TDEF as balanceDecreasingTransactionDef } from "../../../lib/verification/attestation-types/t-00002-balance-decreasing-transaction";
import { TDEF as confirmedBlockHeightExistsDef } from "../../../lib/verification/attestation-types/t-00003-confirmed-block-height-exists";
import { TDEF as referencedPaymentNonexistenceDef } from "../../../lib/verification/attestation-types/t-00004-referenced-payment-nonexistence";

export class StaticAttestationDefinitionStore extends AttestationDefinitionStore {
    constructor() {
        super();
        this.web3 = new Web3();
        this.definitions = [
            paymentDef,
            balanceDecreasingTransactionDef,
            confirmedBlockHeightExistsDef,
            referencedPaymentNonexistenceDef,
        ];
    }
}
