import { expectRevert } from "@openzeppelin/test-helpers";
import { ZERO_ADDRESS } from "../../../lib/utils/helpers";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { testChainInfo } from "../utils/TestChainInfo";

contract(`AuditV3Diamond.ts; ${getTestFile(__filename)}; FAsset diamond design audit tests`, async accounts => {
    const governance = accounts[10];
    // addresses on mock underlying chain can be any string, as long as it is unique

    let commonContext: CommonContext;
    let context: AssetContext;

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        return { commonContext, context };
    }

    beforeEach(async () => {
        ({ commonContext, context } = await loadFixtureCopyVars(initialize));
    });

    it.skip("Coinspect - Destroy AssetManagerDiamondCutFacet implementation", async () => {
        // For this test, an extended interface for GovernedBase was coded
        // It extends IGoverned with the initialise() function
        const IDiamondCut = artifacts.require("IDiamondCut");
        const IGovernedBase = artifacts.require("contracts/governance/implementation/GovernedBase.sol:GovernedBase" as "GovernedBase");
        // diamondCuts is an array of facets, the first one is the AssetManagerDiamondCutFacet
        const assetManagerDiamondCutFacetAddr = await context.assetManager.facetAddress('0x1f931c1c');
        // The AssetManagerDiamondCutFacet implements both IDiamondCut and IGovernedBase
        const iDiamondCut = await IDiamondCut.at(assetManagerDiamondCutFacetAddr);
        const iGovernedBase = await IGovernedBase.at(assetManagerDiamondCutFacetAddr);
        // Deploy fake governance settings
        const FakeGovernanceSettings = artifacts.require("GovernanceSettings");
        const fakeGovSettings = await FakeGovernanceSettings.new();
        // Deploy a suicidal contract (will be used in a delegated context)
        const SuicidalContract = artifacts.require("SuicidalMock");
        const suicidalContract = await SuicidalContract.new(ZERO_ADDRESS);
        // Call initialise directly on the implementation
        await iGovernedBase.initialise(fakeGovSettings.address, accounts[1]);
        // Execute the call to selfdestruct the AssetManagerDiamondCutFacet
        // getTimelock() == 0 from the FakeGovernanceSettings
        // No call will be enqueued as it will be executed directly
        // get init parameters for the diamondCut call
        const initParametersEncodedCall = suicidalContract.contract.methods.die().encodeABI();
        // Fetch the contract's bytecode
        let bytecode = await web3.eth.getCode(iGovernedBase.address);
        // Calculate the size of the bytecode (subtract 2 for the '0x', divide by 2 to go from hex digits to bytes)
        let size = (bytecode.length - 2) / 2;
        // Call diamondCut passing no Facets, the suicidal contract and die() encoded
        console.log("[BEFORE] - AssetManagerDiamondCutFacet size (bytes):", size);
        let res = await iDiamondCut.diamondCut([], suicidalContract.address, initParametersEncodedCall, { from: accounts[1], });
        // Fetch the contract's bytecode
        bytecode = await web3.eth.getCode(iGovernedBase.address);
        // Calculate the size of the bytecode
        size = (bytecode.length - 2) / 2;
        console.log("[AFTER] - AssetManagerDiamondCutFacet size (bytes):", size);
    });

    it("Fix - Destroy AssetManagerDiamondCutFacet implementation prevented", async () => {
        // For this test, an extended interface for GovernedBase was coded
        // It extends IGoverned with the initialise() function
        const IDiamondCut = artifacts.require("IDiamondCut");
        const IGovernedBase = artifacts.require("contracts/governance/implementation/GovernedBase.sol:GovernedBase" as "GovernedBase");
        // diamondCuts is an array of facets, the first one is the AssetManagerDiamondCutFacet
        const assetManagerDiamondCutFacetAddr = await context.assetManager.facetAddress('0x1f931c1c');
        // The AssetManagerDiamondCutFacet implements both IDiamondCut and IGovernedBase
        const iDiamondCut = await IDiamondCut.at(assetManagerDiamondCutFacetAddr);
        const iGovernedBase = await IGovernedBase.at(assetManagerDiamondCutFacetAddr);
        // Deploy fake governance settings
        const FakeGovernanceSettings = artifacts.require("GovernanceSettings");
        const fakeGovSettings = await FakeGovernanceSettings.new();
        // Deploy a suicidal contract (will be used in a delegated context)
        const SuicidalContract = artifacts.require("SuicidalMock");
        const suicidalContract = await SuicidalContract.new(ZERO_ADDRESS);
        // Call initialise directly on the implementation
        await expectRevert(iGovernedBase.initialise(fakeGovSettings.address, accounts[1]), "initialised != false");
    });
});
