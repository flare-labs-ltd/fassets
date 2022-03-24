import { balance, constants, ether, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../typechain-truffle";
import { Web3EventDecoder } from "../../utils/EventDecoder";
import { findRequiredEvent } from "../../utils/events";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../utils/fasset/AttestationHelper";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../utils/fasset/PaymentReference";
import { getTestFile, toBN, toBNExp, toStringExp } from "../../utils/helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { SourceId } from "../../utils/verification/sources/sources";
import { assertWeb3DeepEqual, assertWeb3Equal, web3ResultStruct } from "../../utils/web3assertions";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

async function createTestSettings(attestationClient: AttestationClientMockInstance, wNat: WNatInstance, ftsoRegistry: FtsoRegistryMockInstance): Promise<AssetManagerSettings> {
    return {
        attestationClient: attestationClient.address,
        wNat: wNat.address,
        ftsoRegistry: ftsoRegistry.address,
        natFtsoIndex: (await ftsoRegistry.getFtsoIndex("NAT")).toString(),
        assetFtsoIndex: (await ftsoRegistry.getFtsoIndex("ETH")).toString(),
        burnAddress: constants.ZERO_ADDRESS,
        chainId: 1,
        collateralReservationFeeBIPS: 100,                      // 1%
        assetUnitUBA: toStringExp(1, 18),                       // 1e18 wei per eth
        assetMintingGranularityUBA: toStringExp(1, 9),          // 1e9 = 1 gwei
        lotSizeAMG: toStringExp(1_000, 9),                      // 1000 eth
        requireEOAAddressProof: true,
        initialMinCollateralRatioBIPS: 2_1000,                  // 2.1
        liquidationMinCollateralCallBandBIPS: 1_9000,           // 1.9
        liquidationMinCollateralRatioBIPS: 2_5000,              // 2.5
        underlyingBlocksForPayment: 10,
        underlyingSecondsForPayment: 120,                       // 12s per block assumed
        redemptionFeeBips: 200,                                 // 2%
        redemptionFailureFactorBIPS: 1_2000,                    // 1.2
        redemptionByAnybodyAfterSeconds: 6 * 3600,              // 6 hours
        redemptionConfirmRewardNATWei: toStringExp(100, 18),    // 100 NAT
        maxRedeemedTickets: 20,                                 // TODO: find number that fits comfortably in gas limits
        paymentChallengeRewardBIPS: 0,
        paymentChallengeRewardNATWei: toStringExp(300, 18),     // 300 NAT
        withdrawalWaitMinSeconds: 300,
        liquidationPricePremiumBIPS: 1_2500,                    // 1.25
        liquidationCollateralPremiumBIPS: [6000, 8000, 10000],
        newLiquidationStepAfterMinSeconds: 90,
    };
}

function randomAddress() {
    return web3.utils.toChecksumAddress(web3.utils.randomHex(20))
}

contract(`AssetManager.sol; ${getTestFile(__filename)}; Asset manager basic tests`, async accounts => {
    const governance = accounts[10];
    const assetManagerController = accounts[11];
    let attestationClient: AttestationClientMockInstance;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wnat: WNatInstance;
    let natFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    let settings: AssetManagerSettings;
    const chainId: SourceId = 1;
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;
    let eventDecoder: Web3EventDecoder;
    
    // addresses
    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const minter1 = accounts[30];
    const underlyingMinter1 = "Minter1";
    const redeemer1 = accounts[40];
    const underlyingRedeemer1 = "Redeemer1";
    const challenger1 = accounts[50];

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
        await natFtso.setCurrentPrice(toBNExp(1.12, 5));
        assetFtso = await FtsoMock.new("ETH");
        await assetFtso.setCurrentPrice(toBNExp(3521, 5));
        // create ftso registry
        const ftsoRegistry = await FtsoRegistryMock.new();
        await ftsoRegistry.addFtso(natFtso.address);
        await ftsoRegistry.addFtso(assetFtso.address);
        // create asset manager
        settings = await createTestSettings(attestationClient, wnat, ftsoRegistry);
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
            assertWeb3DeepEqual(resSettings, settings);
        });

        it("should update settings correctly", async () => {
            // act
            const newSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            newSettings.collateralReservationFeeBIPS = 150;
            await assetManager.updateSettings(newSettings, { from: assetManagerController });
            // assert
            const res = web3ResultStruct(await assetManager.getSettings());
            assertWeb3DeepEqual(newSettings, res);
        });

        it("should fail updating immutable settings", async () => {
            // act
            const currentSettings: AssetManagerSettings = web3ResultStruct(await assetManager.getSettings());
            // assert
            const settingImmutable = "setting immutable";
            await expectRevert(assetManager.updateSettings({ ...currentSettings, burnAddress: "0x0000000000000000000000000000000000000001" }, { from: assetManagerController }),
                settingImmutable);
            await expectRevert(assetManager.updateSettings({ ...currentSettings, chainId: 2 }, { from: assetManagerController }),
                settingImmutable);
            await expectRevert(assetManager.updateSettings({ ...currentSettings, assetUnitUBA: 10000 }, { from: assetManagerController }),
                settingImmutable);
            await expectRevert(assetManager.updateSettings({ ...currentSettings, assetMintingGranularityUBA: 10000 }, { from: assetManagerController }),
                settingImmutable);
            await expectRevert(assetManager.updateSettings({ ...currentSettings, requireEOAAddressProof: false }, { from: assetManagerController }),
                settingImmutable);
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

        it("should destroy agent", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            // act
            const res = await assetManager.destroyAgent(agentVault.address, agentOwner1, { from: agentOwner1 });
            // assert
            expectEvent(res, "AgentDestroyed", { agentVault: agentVault.address });
        });

        it("only owner can destroy agent", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            // act
            // assert
            await expectRevert(assetManager.destroyAgent(agentVault.address, agentOwner1),
                "only agent vault owner");
        });

        it("cannot destroy agent if it holds collateral, unannounced for withdrawal", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            // act
            await agentVault.deposit({ from: agentOwner1, value: ether('1') });
            // assert
            await expectRevert(assetManager.destroyAgent(agentVault.address, agentOwner1, { from: agentOwner1 }),
                "withdrawal: not announced");
        });

        it("should destroy agent after announced withdrawal time passes", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            const amount = ether('1');
            await agentVault.deposit({ from: agentOwner1, value: amount });
            // act
            await assetManager.announceCollateralWithdrawal(agentVault.address, amount, { from: agentOwner1 });
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
        
    });
});
