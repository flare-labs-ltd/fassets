export interface CommonParameters {
    /**
     * The governance address used during deploy.
     */
    initialGovernance: string;
    
    /**
     * Address for the governance settings contract to be used in production mode.
     * Will be a genesis contract 0x1000000000000000000000000000000000000007 on Flare and 
     * a deployed contract address on Songbird.
     */
    governanceSettings: string;

    /**
     * Address of the address updater contract.
     */
    addressUpdater: string;
}
