export interface AssetManagerNetworkParameters {
    /**
     * Symbol for the native currency (FLR/SGB/...).
     * Must match the FTSO contract symbol for native currency.
     */
    natSymbol: string;

    /**
     * Address for burning native currency (e.g. for collateral reservation fee afetr successful minting).
     */
    burnAddress: string;

    /**
     * If true, the NAT burning is done indirectly via transfer to burner contract and then self-destruct.
     * This is necessary on Songbird, where the burn address is unpayable.
     */
    burnWithSelfDestruct: boolean;
}

export interface AssetManagerControllerParameters {
    /**
    * JSON schema url
    */
    $schema?: string;

    /**
      * The list of asset manager parameter files to be deployed immediatelly.
      * Filenames are relative to this file's directory.
      */
    deployAssetManagerParameterFiles: string[];

    /**
     * The list of asset managers (addresses are obtained from contract file) to be attached immediatelly.
     * This only makes sense when asset manager controller is replaced.
     * Afterwards, a governance call to AddressUpdater is required to actually set the new
     * controller to these asset managers.
     */
    attachAssetManagerContractNames: string[];

    /**
     * Common parameters that will be used in deploy of all asset managers on this network.
     */
    networkParameters: AssetManagerNetworkParameters;
}
