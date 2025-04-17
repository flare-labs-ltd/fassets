import { FAssetContractStore } from "../../lib/contracts";
import { runAsyncMain } from "../../lib/deploy-utils";
import { executeTimelockedGovernanceCall } from "../../../test/utils/contract-test-helpers";

const AddressUpdater = artifacts.require('AddressUpdater');

runAsyncMain(async () => {
    const contracts = new FAssetContractStore("deployment/deploys/hardhat.json", true);
    const addressUpdater = await AddressUpdater.at(contracts.AddressUpdater.address);
    await executeTimelockedGovernanceCall(addressUpdater, (governance) =>
        addressUpdater.addOrUpdateContractNamesAndAddresses(["AssetManagerController"], [contracts.AssetManagerController!.address], { from: governance }));
});
