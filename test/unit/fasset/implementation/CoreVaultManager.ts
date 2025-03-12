import { expectRevert } from "@openzeppelin/test-helpers";
import { CoreVaultManagerInstance, CoreVaultManagerProxyInstance } from "../../../../typechain-truffle";
import { GENESIS_GOVERNANCE_ADDRESS } from "../../../utils/constants";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";

const CoreVaultManager = artifacts.require('CoreVaultManager');
const CoreVaultManagerProxy = artifacts.require('CoreVaultManagerProxy');
const GovernanceSettings = artifacts.require('GovernanceSettings');

contract(`CoreVaultManager.sol; ${getTestFile(__filename)}; CoreVaultManager basic tests`, async accounts => {
    let coreVaultManager: CoreVaultManagerInstance;
    let coreVaultManagerProxy: CoreVaultManagerProxyInstance;
    let coreVaultManagerImplementation: CoreVaultManagerInstance;
    const governance = accounts[1000];
    const addressUpdater = accounts[100];
    const assetManager = accounts[101];
    const custodianAddress = "custodianAddress";
    const coreVaultAddress = "coreVaultAddress";

   async function initialize() {
        // create governance settings
        const governanceSettings = await GovernanceSettings.new();
        await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE_ADDRESS });
        // create core vault manager
        coreVaultManagerImplementation = await CoreVaultManager.new();
        coreVaultManagerProxy = await CoreVaultManagerProxy.new(
            coreVaultManagerImplementation.address,
            governanceSettings.address,
            governance,
            addressUpdater,
            assetManager,
            web3.utils.keccak256("123"),
            custodianAddress,
            coreVaultAddress,
            0
        );
        coreVaultManager = await CoreVaultManager.at(coreVaultManagerProxy.address);
        // await coreVaultManager.switchToProductionMode({ from: governance });
        return { coreVaultManager };
    }

    beforeEach(async () => {
        ({ coreVaultManager } = await loadFixtureCopyVars(initialize));
    });

    it("should add and get allowed destination addresses", async () => {
        await coreVaultManager.addAllowedDestinationAddresses(["addr1", "addr2"], { from: governance });
        const allowedDestinationAddresses = await coreVaultManager.getAllowedDestinationAddresses();
        expect(allowedDestinationAddresses.length).to.equal(2);
        expect(allowedDestinationAddresses[0]).to.equal("addr1");
        expect(allowedDestinationAddresses[1]).to.equal("addr2");

        // if address already exists, it should not be added again
        await coreVaultManager.addAllowedDestinationAddresses(["addr3", "addr1"], { from: governance });
        const allowedDestinationAddresses2 = await coreVaultManager.getAllowedDestinationAddresses();
        expect(allowedDestinationAddresses2.length).to.equal(3);
        expect(allowedDestinationAddresses2[0]).to.equal("addr1");
        expect(allowedDestinationAddresses2[1]).to.equal("addr2");
        expect(allowedDestinationAddresses2[2]).to.equal("addr3");
    });

    it("should revert adding allowed destination address if not from governance", async () => {
        const tx = coreVaultManager.addAllowedDestinationAddresses([accounts[1]], { from: accounts[2] });
        await expectRevert(tx, "only governance");
    });

    it("should revert adding empty destination address", async () => {
        const tx = coreVaultManager.addAllowedDestinationAddresses([""], { from: governance });
        await expectRevert(tx, "destination address cannot be empty");
    });


    // it("should add triggering accounts", async () => {
    //     await coreVaultManager.addTriggeringAccounts([accounts[1]], { from: governance });
    //     const triggeringAccounts = await coreVaultManager.triggeringAccounts();
    //     expect(triggeringAccounts.length).to.equal(1);
    //     expect(triggeringAccounts[0]).to.equal(accounts[1]);
    // });

    it("should revert adding triggering account if not from governance", async () => {
        const tx = coreVaultManager.addTriggeringAccounts([accounts[1]], { from: accounts[2] });
        await expectRevert(tx, "only governance");
    });

});
