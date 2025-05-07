// Mapped to integer in JSON schema.
type integer = number;

export interface CoreVaultManagerParameters {
    /**
     * JSON schema url
     */
    $schema?: string;

    /**
     * The corrsponding asset manager, either the address or the name in the contracts file.
     */
    assetManager: string;

    /**
     * The underlying address of the core vault multisig.
     * @pattern ^\w+$
     */
    underlyingAddress: string;

    /**
     * The nonce (sequence number) on the multisig address at the deploy time.
     * After deploy, only transactions requested by the core vault manager should be sent from this address, otherwise the nsequence numbering will lose sync.
     * @pattern ^\w+$
     */
    initialSequenceNumber: integer;

    /**
     * The underlying address of the core vault custodian.
     * @pattern ^\w+$
     */
    custodianAddress: string;

    /**
     * Single escrow amount, in chain base units (setting to 0 disables escrows).
     * @pattern ^[0-9 ]+$
     */
    escrowAmount: string;

    /**
     * The time of day (UTC) when the escrows expire. Exactly one escrow per day will expire.
     */
    escrowEndTimeSeconds: integer;

    /**
     * The minimal amount that will be left on the multisig after escrowing, in chain base units.
     * @pattern ^[0-9 ]+$
     */
    minimalAmountLeft: string;

    /**
     * The fee charged by the chain for each payment, in chain base units.
     * @pattern ^[0-9 ]+$
     */
    chainPaymentFee: string;
}
