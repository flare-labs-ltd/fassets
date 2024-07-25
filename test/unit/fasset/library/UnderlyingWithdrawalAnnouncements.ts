import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { eventArgs, requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { toBN } from "../../../../lib/utils/helpers";
import { ERC20MockInstance, FAssetInstance, IIAssetManagerInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { AssetManagerInitSettings, newAssetManager } from "../../../utils/fasset/CreateAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestFtsos, TestSettingsContracts, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings } from "../../../utils/test-settings";
import { assertWeb3Equal } from "../../../utils/web3assertions";

contract(`UnderlyingWithdrawalAnnouncements.sol; ${getTestFile(__filename)}; UnderlyingWithdrawalAnnouncements basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let contracts: TestSettingsContracts;
    let assetManager: IIAssetManagerInstance;
    let fAsset: FAssetInstance;
    let wNat: WNatInstance;
    let usdc: ERC20MockInstance;
    let ftsos: TestFtsos;
    let settings: AssetManagerInitSettings;
    let collaterals: CollateralType[];
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;

    // addresses
    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique


    function createAgent(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const vaultCollateralToken = options?.vaultCollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings, chain, wallet, attestationProvider }, owner, underlyingAddress, vaultCollateralToken, options);
    }

    async function initialize() {
        const ci = testChainInfo.eth;
        contracts = await createTestContracts(governance);
        // save some contracts as globals
        ({ wNat } = contracts);
        usdc = contracts.stablecoins.USDC;
        // create FTSOs for nat, stablecoins and asset and set some price
        ftsos = await createTestFtsos(contracts.ftsoRegistry, ci);
        // create mock chain and attestation provider
        chain = new MockChain(await time.latest());
        wallet = new MockChainWallet(chain);
        stateConnectorClient = new MockStateConnectorClient(contracts.stateConnector, { [ci.chainId]: chain }, 'auto');
        attestationProvider = new AttestationHelper(stateConnectorClient, chain, ci.chainId);
        // create asset manager
        collaterals = createTestCollaterals(contracts, ci);
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        settings.announcedUnderlyingConfirmationMinSeconds = toBN(60);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        return { contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset };
    }

    beforeEach(async () => {
        ({ contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset } = await loadFixtureCopyVars(initialize));
    });

    it("should announce underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        const res = await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // assert
        expectEvent(res, "UnderlyingWithdrawalAnnounced", {agentVault: agentVault.address});
        const args = eventArgs(res, "UnderlyingWithdrawalAnnounced");
        assert.isAbove(Number(args.announcementId), 0);
        assert.equal(args.paymentReference, PaymentReference.announcedWithdrawal(args.announcementId));
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, args.announcementId);
    });

    it("should not change announced underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // act
        const promise = assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "announced underlying withdrawal active");
        const info = await assetManager.getAgentInfo(agentVault.address);
        assert.isAbove(Number(info.announcedUnderlyingWithdrawalId), 0);
    });

    it("only owner can announce underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.announceUnderlyingWithdrawal(agentVault.address),
            "only agent vault owner");
    });

    it("should confirm underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const blockId = (await chain.getTransactionBlock(txHash))!.number;
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        await time.increase(settings.announcedUnderlyingConfirmationMinSeconds);
        const res = await assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address, { from: agentOwner1 });
        // assert
        expectEvent(res, "UnderlyingWithdrawalConfirmed", {agentVault: agentVault.address, spentUBA: toBN(500), transactionHash: txHash});
        assert.isAbove(Number(eventArgs(res, "UnderlyingWithdrawalConfirmed").announcementId), 0);
    });

    it("should confirm underlying withdrawal both times", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const blockId = (await chain.getTransactionBlock(txHash))!.number;
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        await time.increase(settings.announcedUnderlyingConfirmationMinSeconds);
        const res = await assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address, { from: agentOwner1 });
        //Announce underlying withdrawal again and confirm. Because agent is in full liquidation
        //it will stay in full liquidation
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId2 = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        const txHash2 = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId2));
        const blockId2 = (await chain.getTransactionBlock(txHash2))!.number;
        const proof2 = await attestationProvider.provePayment(txHash2, underlyingAgent1, null);
        await time.increase(settings.announcedUnderlyingConfirmationMinSeconds);
        const res2 = await assetManager.confirmUnderlyingWithdrawal(proof2, agentVault.address, { from: agentOwner1 });
        // assert
        expectEvent(res, "UnderlyingWithdrawalConfirmed", {agentVault: agentVault.address, spentUBA: toBN(500), transactionHash: txHash});
        assert.isAbove(Number(eventArgs(res, "UnderlyingWithdrawalConfirmed").announcementId), 0);
        expectEvent(res2, "UnderlyingWithdrawalConfirmed", {agentVault: agentVault.address, spentUBA: toBN(500), transactionHash: txHash2});
        assert.isAbove(Number(eventArgs(res2, "UnderlyingWithdrawalConfirmed").announcementId), 0);
    });

    it("others can confirm underlying withdrawal after some time, empty token ftso symbol conversion test (convertFromUSD5)", async () => {
        // init
        const ci = testChainInfo.eth;
        collaterals = createTestCollaterals(contracts, ci);
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true, announcedUnderlyingConfirmationMinSeconds: 10 });
        //Make vault collateral token have no ftso symbol and a direct price pair (relevant when calculating reward for confirmation later)
        collaterals[1].tokenFtsoSymbol="";
        collaterals[1].directPricePair = true;
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const blockId = (await chain.getTransactionBlock(txHash))!.number;
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        const manSettings = await assetManager.getSettings();
        await time.increase(manSettings.confirmationByOthersAfterSeconds);
        const res = await assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address, { from: accounts[12] });
        // assert
        expectEvent(res, "UnderlyingWithdrawalConfirmed", {agentVault: agentVault.address, spentUBA: toBN(500), transactionHash: txHash});
        assert.isAbove(Number(eventArgs(res, "UnderlyingWithdrawalConfirmed").announcementId), 0);
    });

    it("others can confirm underlying withdrawal after some time", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const blockId = (await chain.getTransactionBlock(txHash))!.number;
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        const settings = await assetManager.getSettings();
        await time.increase(settings.confirmationByOthersAfterSeconds);
        const res = await assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address, { from: accounts[12] });
        // assert
        expectEvent(res, "UnderlyingWithdrawalConfirmed", {agentVault: agentVault.address, spentUBA: toBN(500), transactionHash: txHash});
        assert.isAbove(Number(eventArgs(res, "UnderlyingWithdrawalConfirmed").announcementId), 0);
    });

    it("only owner can confirm underlying withdrawal immediatelly", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        // assert
        await expectRevert(assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address),
            "only agent vault owner");
    });

    it("only announced payment can be confirmed", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        // assert
        await expectRevert(assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address, { from: agentOwner1 }),
            "no active announcement");
    });

    it("should revert confirming underlying withdrawal if reference is wrong", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(toBN(announcementId).addn(1)));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        // assert
        await expectRevert(assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address),
            "wrong announced pmt reference");
    });

    it("should revert confirming underlying withdrawal if source is wrong", async () => {
        // init
        const underlyingAgent2 = "Agent2"
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent2, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent2, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent2, null);
        // assert
        await expectRevert(assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address),
            "wrong announced pmt source");
    });

    it("should cancel underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const announceRes = await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announceArgs = requiredEventArgs(announceRes, "UnderlyingWithdrawalAnnounced");
        // act
        await time.increase(settings.announcedUnderlyingConfirmationMinSeconds);
        const res = await assetManager.cancelUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // assert
        expectEvent(res, "UnderlyingWithdrawalCancelled", {agentVault: agentVault.address, announcementId: announceArgs.announcementId})
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 0);
    });

    it("only owner can cancel underlying withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const announceRes = await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announceArgs = requiredEventArgs(announceRes, "UnderlyingWithdrawalAnnounced");
        // act
        const promise = assetManager.cancelUnderlyingWithdrawal(agentVault.address);
        // assert
        await expectRevert(promise, "only agent vault owner");
        const info = await assetManager.getAgentInfo(agentVault.address);
        assert.notEqual(Number(info.announcedUnderlyingWithdrawalId), 0);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, announceArgs.announcementId);
    });

    it("should cancel underlying withdrawal only if active", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        const promise = assetManager.cancelUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "no active announcement");
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 0);
    });

    it("should not be able to cancel underlying withdrawal if called to soon", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        const announceRes = await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const promise = assetManager.cancelUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        await expectRevert(promise,"cancel too soon");
    });

    it("should not confirm underlying withdrawal if called too soon", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, 500);
        await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
        const announcementId = (await assetManager.getAgentInfo(agentVault.address)).announcedUnderlyingWithdrawalId;
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 500, PaymentReference.announcedWithdrawal(announcementId));
        const blockId = (await chain.getTransactionBlock(txHash))!.number;
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, null);
        const res = assetManager.confirmUnderlyingWithdrawal(proof, agentVault.address, { from: agentOwner1 });
        await expectRevert(res,"confirmation too soon");
    });
});
