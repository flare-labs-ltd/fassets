import { balance, constants, ether, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WhitelistInstance, WNatInstance } from "../../../../typechain-truffle";
import { Web3EventDecoder } from "../../../utils/EventDecoder";
import { findRequiredEvent } from "../../../utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { DAYS, getTestFile, toBN, toBNExp } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../utils/verification/sources/sources";
import { assertWeb3DeepEqual, assertWeb3Equal, web3ResultStruct } from "../../../utils/web3assertions";
import { createTestSettings } from "../test-settings";
import { Challenger } from "../../../integration/utils/Challenger";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const Whitelist = artifacts.require('Whitelist');

function randomAddress() {
    return web3.utils.toChecksumAddress(web3.utils.randomHex(20))
}

contract(`AssetManager.sol; ${getTestFile(__filename)}; Asset manager basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let attestationClient: AttestationClientMockInstance;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wnat: WNatInstance;
    let ftsoRegistry: FtsoRegistryMockInstance;
    let natFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    let settings: AssetManagerSettings;
    const chainId: SourceId = 1;
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;
    let eventDecoder: Web3EventDecoder;
    let whitelist: WhitelistInstance;
    
    // addresses
    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const minter1 = accounts[30];
    const underlyingMinter1 = "Minter1";
    const redeemer1 = accounts[40];
    const underlyingRedeemer1 = "Redeemer1";
    const challenger1 = accounts[50];
    const whitelistedAccount = accounts[1];


    async function createAgent(chain: MockChain, owner: string, underlyingAddress: string) {
        // mint some funds on underlying address (just enough to make EOA proof)
        chain.mint(underlyingAddress, 101);
        // create and prove transaction from underlyingAddress
        const txHash = await wallet.addTransaction(underlyingAddress, underlyingAddress, 1, PaymentReference.addressOwnership(owner), { maxFee: 100 });
        const proof = await attestationProvider.provePayment(txHash, underlyingAddress, underlyingAddress);
        await assetManager.proveUnderlyingAddressEOA(proof, { from: owner });
        // create agent
        const response = await assetManager.createAgent(underlyingAddress, { from: owner });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        const agentVaultAddress = event.args.agentVault;
        // get vault contract at this address
        return await AgentVault.at(agentVaultAddress);
    }

    beforeEach(async () => {
        // create atetstation client
        attestationClient = await AttestationClient.new();
        // create mock chain attestation provider
        chain = new MockChain();
        wallet = new MockChainWallet(chain);
        stateConnectorClient = new MockStateConnectorClient(attestationClient, { [chainId]: chain }, 'auto');
        attestationProvider = new AttestationHelper(stateConnectorClient, chain, chainId, 0);
        // create WNat token
        wnat = await WNat.new(governance, "NetworkNative", "NAT");
        await setDefaultVPContract(wnat, governance);
        // create FTSOs for nat and asset and set some price
        natFtso = await FtsoMock.new("NAT");
        await natFtso.setCurrentPrice(toBNExp(1.12, 5), 0);
        assetFtso = await FtsoMock.new("ETH");
        await assetFtso.setCurrentPrice(toBNExp(3521, 5), 0);
        // create ftso registry
        ftsoRegistry = await FtsoRegistryMock.new();
        await ftsoRegistry.addFtso(natFtso.address);
        await ftsoRegistry.addFtso(assetFtso.address);
        // create asset manager
        settings = createTestSettings(attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings);
        // create event decoder
        eventDecoder = new Web3EventDecoder({ assetManager });
    });

    describe("set and update settings", () => {
        it("should correctly set asset manager settings", async () => {
            const resFAsset = await assetManager.fAsset();
            assert.notEqual(resFAsset, constants.ZERO_ADDRESS);
            assert.equal(resFAsset, fAsset.address);
            const resSettings = web3ResultStruct(await assetManager.getSettings());
            settings.assetManagerController = assetManagerController;           // added to settings in newAssetManager
            settings.natFtsoIndex = await ftsoRegistry.getFtsoIndex(settings.natFtsoSymbol);        // set in contract
            settings.assetFtsoIndex = await ftsoRegistry.getFtsoIndex(settings.assetFtsoSymbol);    // set in contract
            assertWeb3DeepEqual(resSettings, settings);
            assert.equal(await assetManager.assetManagerController(), assetManagerController);
        });

        it("should update settings correctly", async () => {
            // act
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            newSettings.collateralReservationFeeBIPS = 150;
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("setCollateralReservationFeeBips(uint256)")), 
                web3.eth.abi.encodeParameters(['uint256'], [150]), 
                { from: assetManagerController });
            // assert
            const res = web3ResultStruct(await assetManager.getSettings());
            assertWeb3DeepEqual(newSettings, res);
        });

        it("should revert update settings - invalid method", async () => {
            let res = assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("invalidMethod")), 
            constants.ZERO_ADDRESS,
            { from: assetManagerController });
            await expectRevert(res,"update: invalid method");
        });
    });

    describe("create agent", () => {
        it("should prove EOA address", async () => {
            // init
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            // act
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
            // assert
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
            await assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 });
        });
        
        it("should create agent", async () => {
            // init
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            // act
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
            await assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 });
            const res = await assetManager.createAgent(underlyingAgent1, { from: agentOwner1 });
            // assert
            expectEvent(res, "AgentCreated", { owner: agentOwner1, agentType: toBN(1), underlyingAddress: underlyingAgent1 });
        });

        it("should require EOA check to create agent", async () => {
            // init
            // act
            // assert
            await expectRevert(assetManager.createAgent(underlyingAgent1, { from: agentOwner1 }),
                "EOA proof required");
        });

        it("only owner can destroy agent", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            // act
            // assert
            await expectRevert(assetManager.destroyAgent(agentVault.address, agentOwner1),
                "only agent vault owner");
        });

        it("cannot destroy agent without announcement", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            // act
            // assert
            await expectRevert(assetManager.destroyAgent(agentVault.address, agentOwner1, { from: agentOwner1 }),
                "destroy not announced");
        });

        it("should destroy agent after announced withdrawal time passes", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            const amount = ether('1');
            await agentVault.deposit({ from: agentOwner1, value: amount });
            // act
            await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
            await time.increase(300);
            const recipient = randomAddress();
            const startBalance = await balance.current(recipient);
            await assetManager.destroyAgent(agentVault.address, recipient, { from: agentOwner1 });
            // assert
            const recovered = (await balance.current(recipient)).sub(startBalance);
            // console.log(`recovered = ${recovered},  rec=${recipient}`);
            assert.isTrue(recovered.gte(amount), `value reecovered from agent vault is ${recovered}, which is less than deposited ${amount}`);
        });
        
        it("should change agent's min collateral ratio", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            // act
            const collateralRatioBIPS = 23000;
            await assetManager.setAgentMinCollateralRatioBIPS(agentVault.address, collateralRatioBIPS, { from: agentOwner1 });
            // assert
            const info = await assetManager.getAgentInfo(agentVault.address);
            assertWeb3Equal(info.agentMinCollateralRatioBIPS, collateralRatioBIPS);
        });

        it("should require whitelisting, when whitelist exists, to create agent", async () => {
            whitelist = await Whitelist.new(governance);
            await whitelist.addAddressToWhitelist(whitelistedAccount, {from: governance});
                                
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("setWhitelist(address)")), 
                web3.eth.abi.encodeParameters(['address'], [whitelist.address]), 
                { from: assetManagerController });
            await time.increase(toBN(settings.timelockSeconds).addn(1));
            await time.advanceBlock();
            await assetManager.updateSettings(web3.utils.soliditySha3Raw(web3.utils.asciiToHex("executeSetWhitelist()")), 
                constants.ZERO_ADDRESS,
                { from: assetManagerController });
            // assert
            await expectRevert(assetManager.createAgent(underlyingAgent1, { from: agentOwner1 }),
                "not whitelisted");

            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(whitelistedAccount));
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
            await assetManager.proveUnderlyingAddressEOA(proof, { from: whitelistedAccount });
            expectEvent(await assetManager.createAgent(underlyingAgent1, { from: whitelistedAccount}), "AgentCreated");
        });

        it("should pause and terminate only after 30 days", async () => {
            const MINIMUM_PAUSE_BEFORE_STOP = 30 * DAYS;
            assert.isFalse(await assetManager.paused());
            await assetManager.pause({ from: assetManagerController });
            assert.isTrue(await assetManager.paused());
            await time.increase(MINIMUM_PAUSE_BEFORE_STOP / 2);
            await assetManager.pause({ from: assetManagerController });
            assert.isTrue(await assetManager.paused());
            await expectRevert(assetManager.terminate({ from: assetManagerController }), "asset manager not paused enough");
            await time.increase(MINIMUM_PAUSE_BEFORE_STOP / 2);
            assert.isFalse(await fAsset.terminated());
            await assetManager.terminate({ from: assetManagerController });
            assert.isTrue(await fAsset.terminated());
        });

        it("should not pause if not called from asset manager controller", async () => {
            const promise = assetManager.pause({ from: accounts[0] });
            await expectRevert(promise, "only asset manager controller");
            assert.isFalse(await assetManager.paused());
        });
    });

    describe("challenge agent", () => {

        it.only("should challenge payments making free balance negative", async() => {
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            const txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            const res = await assetManager.freeBalanceNegativeChallenge(
                [proof], agentVault.address, { from: whitelistedAccount });
            expectEvent(res, 'UnderlyingFreeBalanceNegative', {agentVault: agentVault.address});
        });
    });

});
