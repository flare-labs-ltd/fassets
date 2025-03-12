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
    const governance = accounts[0];
    const addressUpdater = accounts[100];
    const assetManager = accounts[101];
    const custodianAddress = "custodianAddress";
    const coreVaultAddres = "coreVaultAddres";

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
            coreVaultAddres,
            0
        );
        coreVaultManager = await CoreVaultManager.at(coreVaultManagerProxy.address);
        await coreVaultManager.switchToProductionMode({ from: governance });
        return { coreVaultManager };
    }

    beforeEach(async () => {
        ({ coreVaultManager } = await loadFixtureCopyVars(initialize));
    });

    it("should revert adding triggering account if not governance", async () => {
        const tx = coreVaultManager.addTriggeringAccounts([accounts[1]], { from: accounts[2] });
        await expectRevert(tx, "only governance");
    });

});
