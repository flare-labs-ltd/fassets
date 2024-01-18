import hre from "hardhat";
import { requiredEventArgs } from "../../lib/utils/events/truffle";
import { getTestFile } from "../../test/utils/test-helpers";
import { createTestAgent } from "../../test/utils/test-settings";
import { AgentOwnerRegistryInstance, AssetManagerControllerInstance } from "../../typechain-truffle";
import { ChainContracts, loadContracts } from "../lib/contracts";
import { loadDeployAccounts, requiredEnvironmentVariable } from "../lib/deploy-utils";
import { SourceId } from "../../lib/underlying-chain/SourceId";
import { AttestationHelper } from "../../lib/underlying-chain/AttestationHelper";

const AssetManagerController = artifacts.require('AssetManagerController');
const AssetManager = artifacts.require('AssetManager');
const AgentOwnerRegistry = artifacts.require('AgentOwnerRegistry');

contract(`test-deployed-contracts; ${getTestFile(__filename)}; Deploy tests`, async accounts => {
    let networkConfig: string;
    let contracts: ChainContracts;

    let assetManagerController: AssetManagerControllerInstance;
    let agentOwnerRegistry: AgentOwnerRegistryInstance;

    before(async () => {
        networkConfig = requiredEnvironmentVariable('NETWORK_CONFIG');
        contracts = loadContracts(`deployment/deploys/${networkConfig}.json`);
        assetManagerController = await AssetManagerController.at(contracts.AssetManagerController!.address);
        agentOwnerRegistry = await AgentOwnerRegistry.at(contracts.AgentOwnerRegistry!.address);
    });

    // it("Controller must be in production mode", async () => {
    //     const production = await assetManagerController.productionMode();
    //     assert.isTrue(production, "not in production mode");
    // });

    it("Controller has at least one manager", async () => {
        const managers = await assetManagerController.getAssetManagers();
        assert.isAbove(managers.length, 0);
    });

    it("All managers must be attached to this controller", async () => {
        const managers = await assetManagerController.getAssetManagers();
        for (const mgrAddress of managers) {
            const assetManager = await AssetManager.at(mgrAddress);
            // must be attached...
            const attached = await assetManager.controllerAttached();
            assert.isTrue(attached, "not attached");
            // ...to this controller
            const mgrController = await assetManager.assetManagerController();
            assert.equal(mgrController, assetManagerController.address);
        }
    });

    // TODO: creating agent vault now requires SC proof of address validity,
    // which takes 5 minutes and requires SC API client, so skip it for now

    // const testUnderlyingAddresses = {
    //     [SourceId.XRP]: 'r9N9XrsUKFJgaAwoL3qtefdjXVxjgxUqWi',
    //     [SourceId.testXRP]: 'r9N9XrsUKFJgaAwoL3qtefdjXVxjgxUqWi',
    //     [SourceId.BTC]: 'mhvLner76vL99PfYFmdzDFqGGqwQyE61xQ',
    //     [SourceId.testBTC]: 'mhvLner76vL99PfYFmdzDFqGGqwQyE61xQ',
    //     [SourceId.DOGE]: 'mr8zwdWkSrxQRrhq7D2i4f4CLZoZgF3nja',
    //     [SourceId.testDOGE]: 'mr8zwdWkSrxQRrhq7D2i4f4CLZoZgF3nja',
    //     [SourceId.LTC]: 'mjGn3j6vrHwgRzRWsXFT6dP1K5atca7yPx',
    //     [SourceId.ALGO]: 'TEST_ADDRESS',
    // };

    // it("Can create an agent on all managers", async () => {
    //     const { deployer } = loadDeployAccounts(hre);
    //     const managers = await assetManagerController.getAssetManagers();
    //     const owner = requiredEnvironmentVariable('TEST_AGENT_OWNER');
    //     await agentWhitelist.addAddressToWhitelist(owner, { from: deployer });
    //     for (const mgrAddress of managers) {
    //         console.log("Testing manager at", mgrAddress);
    //         const assetManager = await AssetManager.at(mgrAddress);
    //         const settings = await assetManager.getSettings();
    //         const collaterals = await assetManager.getCollateralTypes();
    //         // create fake attestation provider -
    //         const attestationProvider = new AttestationHelper(stateConnectorClient, chain, ci.chainId);
    //         // create agent
    //         const underlyingAddress = testUnderlyingAddresses[settings.chainId];    // address doesn't matter - won't do anything on underlying chain
    //         const agentVault = await createTestAgent({ assetManager, settings }, owner, underlyingAddress, collaterals[1].token);
    //         // announce destroy (can really destroy later)
    //         const destroyRes = await assetManager.announceDestroyAgent(agentVault.address, { from: owner });
    //         const destroyArgs = requiredEventArgs(destroyRes, "AgentDestroyAnnounced");
    //         console.log(`    you can destroy agent ${agentVault.address} on asset manager ${mgrAddress} after timestamp ${destroyArgs.destroyAllowedAt}`);
    //     }
    //     await agentWhitelist.revokeAddress(owner, { from: deployer });
    // });

});
