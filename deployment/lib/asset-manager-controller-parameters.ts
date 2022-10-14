export interface AssetManagerControllerParameters {
    /**
    * JSON schema url
    */
    $schema?: string;

   /**
     * The list of asset manager parameter files to be deployed immediatelly.
     */
    deployAssetManagerParameterFiles: string[];
        
    /**
     * The list of asset manager addresses to be attached immediatelly.
     * Afterwards, a governance call to AddressUpdater is required to actually set the new
     * controller to these asset managers.
     */
    attachAssetManagerAddresses: string[];
}
