import { balance, ether, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { UnderlyingWithdrawalAnnounced, CollateralReserved, LiquidationEnded, RedemptionDefault, RedemptionFinished, RedemptionRequested } from "../../../../typechain-truffle/AssetManager";
import { AgentVaultInstance, AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { findRequiredEvent, requiredEventArgs, EventArgs } from "../../../utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { getTestFile, randomAddress, toBN, BNish, toBNExp, toWei } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../utils/verification/sources/sources";
import { createTestSettings } from "../test-settings";


const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

contract(`Agent.sol; ${getTestFile(__filename)}; Agent basic tests`, async accounts => {
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

    let agentVault: AgentVaultInstance;
    let agentVault2: AgentVaultInstance;

    let agentTxHash: string;
    let agentTxProof: any;
    
    // addresses
    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const whitelistedAccount = accounts[1];
    const underlyingRedeemer = "Redeemer";
    const agentOwner2 = accounts[40];
    const underlyingAgent2 = "Agent2";


    async function createAgent(chain: MockChain, owner: string, underlyingAddress: string) {
        // mint some funds on underlying address (just enough to make EOA proof)
        chain.mint(underlyingAddress, 102);
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

    async function makeAgentAvailable(feeBIPS: BNish, collateralRatioBIPS: BNish) {
        const res = await assetManager.makeAgentAvailable(agentVault.address, feeBIPS, collateralRatioBIPS, { from: whitelistedAccount });
        return requiredEventArgs(res, 'AgentAvailable');
    }

        
    async function depositCollateral(amountNATWei: BNish) {
        const res = await agentVault.deposit({ from: whitelistedAccount, value: toBN(amountNATWei) });
        const tr = await web3.eth.getTransaction(res.tx);
        const res2 = await assetManager.getPastEvents('LiquidationEnded', { fromBlock: tr.blockNumber!, toBlock: tr.blockNumber!, filter: {transactionHash: res.tx} })
        return res2.length > 0 ? (res2[0] as any).args as EventArgs<LiquidationEnded> : undefined;
    }

    beforeEach(async () => {
        // create atetstation client
        attestationClient = await AttestationClient.new();
        // create mock chain attestation provider
        chain = new MockChain(await time.latest());
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

        agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        agentVault2 = await createAgent(chain, agentOwner2, underlyingAgent2);

        agentTxHash = await wallet.addTransaction(
            underlyingAgent1, underlyingRedeemer, 1, PaymentReference.redemption(1));
        agentTxProof = await attestationProvider.proveBalanceDecreasingTransaction(agentTxHash, underlyingAgent1);
    });

    describe("illegal payment challenge", () => {

        it("should succeed challenging illegal payment", async() => {
            let txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.redemption(0));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            let res = await assetManager.illegalPaymentChallenge(
                proof, agentVault.address, { from: whitelistedAccount });
            expectEvent(res, "IllegalPaymentConfirmed");
        });

        it("should not succeed challenging illegal payment - verified transaction too old", async() => {
            let txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.redemption(0));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            await time.increase(5 * 86400);
            let res = assetManager.illegalPaymentChallenge(
                proof, agentVault.address, { from: whitelistedAccount });
            await expectRevert(res, "verified transaction too old")
        });
    });

    describe("double payment challenge", () => {

        it("should revert on transactions with same references", async() => {
            let txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.redemption(2));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            let promise = assetManager.doublePaymentChallenge(
                agentTxProof, proof, agentVault.address, { from: whitelistedAccount });
            await expectRevert(promise, "challenge: not duplicate");
        });

        it("should revert on wrong agent's address", async() => {
            let txHash = await wallet.addTransaction(
                underlyingAgent2, underlyingRedeemer, 1, PaymentReference.redemption(2));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent2);
            let promise = assetManager.doublePaymentChallenge(
                agentTxProof, proof, agentVault.address, { from: whitelistedAccount });
            await expectRevert(promise, "chlg 2: not agent's address");
        });

        it("should revert on same references", async() => {
            let promise = assetManager.doublePaymentChallenge(
                agentTxProof, agentTxProof, agentVault.address, { from: whitelistedAccount });
            await expectRevert(promise, "chlg dbl: same transaction");
        });

        it("should successfully challange double payments", async() => {
            let txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.redemption(1));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            let res = await assetManager.doublePaymentChallenge(
                agentTxProof, proof, agentVault.address, { from: whitelistedAccount });
            expectEvent(res, 'DuplicatePaymentConfirmed', {
                agentVault: agentVault.address, transactionHash1: agentTxHash, transactionHash2: txHash
            });
        });
    
    });

    describe("payments making free balance negative challange", () => {

        it("should revert repeated transaction", async() => {
            // payment references match
            let prms1 = assetManager.freeBalanceNegativeChallenge(
                [agentTxProof, agentTxProof], agentVault.address, { from: whitelistedAccount });
            await expectRevert(prms1, "mult chlg: repeated transaction");
        });

        it("should revert if transaction has different sources", async() => {
            let txHashA2 = await wallet.addTransaction(
                underlyingAgent2, underlyingRedeemer, 1, PaymentReference.redemption(2));
            let proofA2 = await attestationProvider.proveBalanceDecreasingTransaction(txHashA2, underlyingAgent2);
            // transaction sources are not the same agent
            let prmsW = assetManager.freeBalanceNegativeChallenge(
                [agentTxProof, proofA2], agentVault.address, { from: whitelistedAccount });
            await expectRevert(prmsW, "mult chlg: not agent's address");
        });

        it("should succeed in challenging payments iff they make balance negative", async() => {
            const info = await assetManager.getAgentInfo(agentVault.address);
            let txHash2 = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.announcedWithdrawal(2));
            let proof2 = await attestationProvider.proveBalanceDecreasingTransaction(txHash2, underlyingAgent1);
            
            /* 
            // enough free balance
            let prms2 = assetManager.freeBalanceNegativeChallenge(
                [proof1], agentVault.address, { from: whitelistedAccount });
            await expectRevert(prms2, "mult chlg: enough free balance");
            
            let txHash2 = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 100000, PaymentReference.announcedWithdrawal(2));
            let proof2 = await attestationProvider.proveBalanceDecreasingTransaction(txHash2, underlyingAgent1); */
            
            // successful challenge
            let res1 = await assetManager.freeBalanceNegativeChallenge(
                [agentTxProof, proof2], agentVault.address, { from: whitelistedAccount });
            expectEvent(res1, 'UnderlyingFreeBalanceNegative', {agentVault: agentVault.address});
        });
    });

});
