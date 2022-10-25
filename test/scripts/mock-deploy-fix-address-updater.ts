import { loadContracts } from "../../deployment/lib/contracts";
import { executeTimelockedGovernanceCall } from "../utils/contract-test-helpers";
import { getTestFile } from "../utils/test-helpers";

const AddressUpdater = artifacts.require('AddressUpdater');

contract(`mock-deploy-fix-address-updater; ${getTestFile(__filename)}; Add mock-deployed contracts to address updater`, accounts => {
    it("add mock-deployed contracts to address updater", async () => {
        const contracts = loadContracts("deployment/deploys/hardhat.json");
        const addressUpdater = await AddressUpdater.at(contracts.AddressUpdater.address);
        await executeTimelockedGovernanceCall(addressUpdater, (governance) => 
            addressUpdater.addOrUpdateContractNamesAndAddresses(["AttestationClient"], [contracts.AttestationClient!.address], { from: governance }));
        await executeTimelockedGovernanceCall(addressUpdater, (governance) =>
            addressUpdater.addOrUpdateContractNamesAndAddresses(["AgentVaultFactory"], [contracts.AgentVaultFactory!.address], { from: governance }));
        await executeTimelockedGovernanceCall(addressUpdater, (governance) =>
            addressUpdater.addOrUpdateContractNamesAndAddresses(["AssetManagerController"], [contracts.AssetManagerController!.address], { from: governance }));
    });
});
