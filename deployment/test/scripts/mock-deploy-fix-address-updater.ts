import { loadContracts } from "../../lib/contracts";
import { runAsyncMain } from "../../../lib/utils/helpers";
import { executeTimelockedGovernanceCall } from "../../../test/utils/contract-test-helpers";

const AddressUpdater = artifacts.require('AddressUpdater');

runAsyncMain(async () => {
    const contracts = loadContracts("deployment/deploys/hardhat.json");
    const addressUpdater = await AddressUpdater.at(contracts.AddressUpdater.address);
    await executeTimelockedGovernanceCall(addressUpdater, (governance) =>
        addressUpdater.addOrUpdateContractNamesAndAddresses(["AssetManagerController"], [contracts.AssetManagerController!.address], { from: governance }));
});
