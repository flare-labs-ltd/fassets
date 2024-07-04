import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { AssetManagerInitInstance, ERC20MockInstance, FAssetInstance, IIAssetManagerInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { executeTimelockedGovernanceCall } from "../../../utils/contract-test-helpers";
import { DiamondCut, DiamondSelectors, FacetCutAction } from "../../../../lib/utils/diamond";
import { deployAssetManagerFacets, newAssetManager } from "../../../utils/fasset/CreateAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestFtsos, TestSettingsContracts, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings } from "../../../utils/test-settings";

contract(`AssetManager.sol; ${getTestFile(__filename)}; Asset manager diamond tests`, async accounts => {
    const governance = accounts[10];
    const executor = accounts[11];
    let assetManagerController = accounts[11];
    let contracts: TestSettingsContracts;
    let assetManagerInit: AssetManagerInitInstance;
    let diamondCuts: DiamondCut[];
    let assetManager: IIAssetManagerInstance;
    let fAsset: FAssetInstance;
    let wNat: WNatInstance;
    let usdc: ERC20MockInstance;
    let ftsos: TestFtsos;
    let settings: AssetManagerSettings;
    let collaterals: CollateralType[];
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;
    let usdt: ERC20MockInstance;

    async function initialize() {
        const ci = testChainInfo.xrp;
        contracts = await createTestContracts(governance);
        await contracts.governanceSettings.setExecutors([executor], { from: governance });
        [diamondCuts, assetManagerInit] = await deployAssetManagerFacets();
        // save some contracts as globals
        ({ wNat } = contracts);
        usdc = contracts.stablecoins.USDC;
        usdt = contracts.stablecoins.USDT;
        // create FTSOs for nat, stablecoins and asset and set some price
        ftsos = await createTestFtsos(contracts.ftsoRegistry, ci);
        // create mock chain and attestation provider
        chain = new MockChain(await time.latest());
        wallet = new MockChainWallet(chain);
        stateConnectorClient = new MockStateConnectorClient(contracts.stateConnector, { [ci.chainId]: chain }, 'auto');
        attestationProvider = new AttestationHelper(stateConnectorClient, chain, ci.chainId);
        // create asset manager
        collaterals = createTestCollaterals(contracts, ci);
        settings = createTestSettings(contracts, ci);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol,
            { governanceSettings: contracts.governanceSettings, updateExecutor: executor });
        await assetManager.switchToProductionMode({ from: governance });
        return { contracts, diamondCuts, assetManagerInit, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset, usdt };
    }

    beforeEach(async () => {
        ({ contracts, diamondCuts, assetManagerInit, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset, usdt } = await loadFixtureCopyVars(initialize));
    });

    describe("governed with extra timelock", () => {
        it("can add a new cut to asset manager", async () => {
            const test1Facet = await artifacts.require("Test1Facet").new();
            const selectors = DiamondSelectors.fromABI(test1Facet).remove(["supportsInterface(bytes4)"]);
            const test1Cut: DiamondCut = {
                action: FacetCutAction.Add,
                facetAddress: test1Facet.address,
                functionSelectors: selectors.selectors
            };
            await executeTimelockedGovernanceCall(assetManager, (gov) => assetManager.diamondCut([test1Cut], constants.ZERO_ADDRESS, "0x0", { from: gov }));
            // assert
            const loupeRes = await assetManager.facetFunctionSelectors(test1Facet.address);
            assert.isAbove(loupeRes.length, 10);
        });

        it("must wait at least diamondCutMinTimelockSeconds when adding cut", async () => {
            const test1Facet = await artifacts.require("Test1Facet").new();
            const selectors = DiamondSelectors.fromABI(test1Facet).remove(["supportsInterface(bytes4)"]);
            const test1Cut: DiamondCut = {
                action: FacetCutAction.Add,
                facetAddress: test1Facet.address,
                functionSelectors: selectors.selectors
            };
            const res = await assetManager.diamondCut([test1Cut], constants.ZERO_ADDRESS, "0x0", { from: governance });
            const timelocked = requiredEventArgs(res, "GovernanceCallTimelocked");
            // assert
            await time.increase(300);
            await expectRevert(assetManager.executeGovernanceCall(timelocked.encodedCall, { from: executor }),
                "timelock: not allowed yet");
            await time.increase(3600);
            await assetManager.executeGovernanceCall(timelocked.encodedCall, { from: executor });
        });

        it("if diamondCutMinTimelockSeconds is small, GovernanceSettings.timelock applies", async () => {
            // init
            const ci = testChainInfo.xrp;
            const settings2: AssetManagerSettings = { ...settings, diamondCutMinTimelockSeconds: 0 };
            const [assetManager2] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings2, collaterals, ci.assetName, ci.assetSymbol,
                { governanceSettings: contracts.governanceSettings, updateExecutor: executor });
            await assetManager2.switchToProductionMode({ from: governance });
            // act
            const test1Facet = await artifacts.require("Test1Facet").new();
            const selectors = DiamondSelectors.fromABI(test1Facet).remove(["supportsInterface(bytes4)"]);
            const test1Cut: DiamondCut = {
                action: FacetCutAction.Add,
                facetAddress: test1Facet.address,
                functionSelectors: selectors.selectors
            };
            const res = await assetManager2.diamondCut([test1Cut], constants.ZERO_ADDRESS, "0x0", { from: governance });
            const timelocked = requiredEventArgs(res, "GovernanceCallTimelocked");
            // assert
            await time.increase(30);
            await expectRevert(assetManager2.executeGovernanceCall(timelocked.encodedCall, { from: executor }),
                "timelock: not allowed yet");
            await time.increase(60);
            await assetManager2.executeGovernanceCall(timelocked.encodedCall, { from: executor });
        });
    });
});
