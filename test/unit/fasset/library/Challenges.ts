import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSettings, AssetManagerSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { filterEvents, requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { toBNExp, toWei } from "../../../../lib/utils/helpers";
import { AgentVaultInstance, AssetManagerInstance, ERC20MockInstance, FAssetInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { newAssetManager } from "../../../utils/fasset/CreateAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestFtsos, TestSettingsContracts, createEncodedTestLiquidationSettings, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings } from "../../../utils/test-settings";

const ContingencyPool = artifacts.require('ContingencyPool');
const ContingencyPoolToken = artifacts.require('ContingencyPoolToken');

contract(`Challenges.sol; ${getTestFile(__filename)}; Challenges basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let contracts: TestSettingsContracts;
    let assetManager: AssetManagerInstance;
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
    const underlyingMinterAddress = "Minter";
    const minterAddress1 = accounts[30];
    const underlyingRedeemer1 = "Redeemer1";
    const redeemerAddress1 = accounts[50]


    function createAgentVault(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const vaultCollateralToken = options?.vaultCollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings, chain, wallet, attestationProvider }, owner, underlyingAddress, vaultCollateralToken, options);
    }

    async function depositAndMakeAgentAvailable(agentVault: AgentVaultInstance, owner: string) {
        // depositCollateral
        const agentPoolTokens = toWei(3e8);
        const vaultCollateral = toBNExp(240_000, 18);
        await usdc.mintAmount(owner, vaultCollateral);
        await usdc.increaseAllowance(agentVault.address, vaultCollateral, { from: owner });
        await agentVault.depositCollateral(usdc.address, vaultCollateral, { from: owner });
        await depositPoolTokens(agentVault, owner, agentPoolTokens);
        await assetManager.makeAgentAvailable(agentVault.address, { from: owner });
    }

    async function updateUnderlyingBlock() {
        const proof = await attestationProvider.proveConfirmedBlockHeightExists(Number(settings.attestationWindowSeconds));
        await assetManager.updateCurrentBlock(proof);
    }

    async function mint(agentVault: AgentVaultInstance, lots: number, minterAddress: string, chain: MockChain, underlyingMinterAddress: string, updateBlock: boolean) {
        chain.mint(underlyingMinterAddress, toBNExp(10000, 18));
        if (updateBlock) await updateUnderlyingBlock();
        // perform minting
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, { from: minterAddress, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinterAddress, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinterAddress, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async function mintAndRedeem(agentVault: AgentVaultInstance, chain: MockChain, underlyingMinterAddress: string, minterAddress: string, underlyingRedeemerAddress: string, redeemerAddress: string, updateBlock: boolean) {
        const lots = 3;
        // minter
        const minted = await mint(agentVault, lots, minterAddress, chain, underlyingMinterAddress, updateBlock);
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress, minted.mintedAmountUBA, { from: minterAddress });
        // redemption request
        const resR = await assetManager.redeem(lots, underlyingRedeemerAddress, { from: redeemerAddress });
        const redemptionRequests = filterEvents(resR, 'RedemptionRequested').map(e => e.args);
        const request = redemptionRequests[0];
        return request;
    }

    async function depositPoolTokens(agentVault: AgentVaultInstance, owner: string, tokens: BN) {
        const pool = await ContingencyPool.at(await assetManager.getContingencyPool(agentVault.address));
        const poolToken = await ContingencyPoolToken.at(await pool.poolToken());
        await pool.enter(0, false, { value: tokens, from: owner }); // owner will get at least `tokens` of tokens
        await poolToken.transfer(agentVault.address, tokens, { from: owner });
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
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, createEncodedTestLiquidationSettings());

        agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        agentVault2 = await createAgentVault(agentOwner2, underlyingAgent2);

        agentTxHash = await wallet.addTransaction(underlyingAgent1, underlyingRedeemer, toWei(1), PaymentReference.redemption(1));
        agentTxProof = await attestationProvider.proveBalanceDecreasingTransaction(agentTxHash, underlyingAgent1);
        return { contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset, agentVault, agentVault2, agentTxHash, agentTxProof };
    };

    beforeEach(async () => {
        ({ contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset, agentVault, agentVault2, agentTxHash, agentTxProof } =
            await loadFixtureCopyVars(initialize));
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

        it("should succeed challenging illegal payment for redemption", async() => {
            let txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.redemption(1));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            let res = await assetManager.illegalPaymentChallenge(
                proof, agentVault.address, { from: whitelistedAccount });
            expectEvent(res, "IllegalPaymentConfirmed");
        });

        it("should succeed challenging illegal withdrawal payment", async() => {
            let txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.announcedWithdrawal(1));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            let res = await assetManager.illegalPaymentChallenge(
                proof, agentVault.address, { from: whitelistedAccount });
            expectEvent(res, "IllegalPaymentConfirmed");
        });

        it("should succeed challenging illegal withdrawal payment - no announcement, zero id in reference", async () => {
            let txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.announcedWithdrawal(0));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            let res = await assetManager.illegalPaymentChallenge(
                proof, agentVault.address, { from: whitelistedAccount });
            expectEvent(res, "IllegalPaymentConfirmed");
        });

        it("should not succeed challenging illegal payment - verified transaction too old", async() => {
            let txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.redemption(0));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);

            await time.increase(14 * 86400);
            let res = assetManager.illegalPaymentChallenge(
                proof, agentVault.address, { from: whitelistedAccount });
            await expectRevert(res, "verified transaction too old")
        });

        it("should not succeed challenging illegal payment - chlg: not agent's address", async () => {
            let txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.redemption(0));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);

            let res = assetManager.illegalPaymentChallenge(
                proof, agentVault2.address, { from: whitelistedAccount });
            await expectRevert(res, "chlg: not agent's address")
        });

        it("should not succeed challenging illegal payment - matching ongoing announced pmt", async () => {
            const resp = await assetManager.announceUnderlyingWithdrawal(agentVault.address, { from: agentOwner1 });
            const req = requiredEventArgs(resp, 'UnderlyingWithdrawalAnnounced')
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingRedeemer, 1, req.paymentReference);

            const proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            const res = assetManager.illegalPaymentChallenge(proof, agentVault.address, { from: whitelistedAccount });
            await expectRevert(res, 'matching ongoing announced pmt');
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

        it("should revert on not agent's address", async() => {
            let txHash = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, 1, PaymentReference.redemption(1));
            let proof = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
            let res = assetManager.doublePaymentChallenge(
                agentTxProof, proof, agentVault2.address, { from: whitelistedAccount });
            await expectRevert(res, "chlg 1: not agent's address");
        });

        it("should successfully challenge double payments", async() => {
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

        it("should revert - already confirmed payments should be ignored", async () => {
            // init
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinterAddress, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
            //perform redemption payment
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
            const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
            await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });

            let proof2 = await attestationProvider.proveBalanceDecreasingTransaction(tx1Hash, underlyingAgent1);

            let res = assetManager.freeBalanceNegativeChallenge([agentTxProof, proof2], agentVault.address, { from: whitelistedAccount });
            await expectRevert(res, "mult chlg: enough balance");
        });

        it("should revert - mult chlg: enough balance", async () => {
            // init
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinterAddress, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
            //perform redemption payment
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
            const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
            await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });

            let txHash2 = await wallet.addTransaction(underlyingAgent1, underlyingRedeemer, 1, PaymentReference.announcedWithdrawal(2));
            let proof2 = await attestationProvider.proveBalanceDecreasingTransaction(txHash2, underlyingAgent1);

            let res = assetManager.freeBalanceNegativeChallenge([agentTxProof, proof2], agentVault.address, { from: whitelistedAccount });
            await expectRevert(res, "mult chlg: enough balance");
        });

        it("should succeed in challenging payments if they make balance negative", async() => {
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            await mint(agentVault, 1, minterAddress1, chain, underlyingMinterAddress, true);
            // const info = await assetManager.getAgentInfo(agentVault.address);
            // console.log(deepFormat(info));
            let txHash2 = await wallet.addTransaction(
                underlyingAgent1, underlyingRedeemer, toWei(1.5), PaymentReference.announcedWithdrawal(2));
            let proof2 = await attestationProvider.proveBalanceDecreasingTransaction(txHash2, underlyingAgent1);
            // successful challenge
            let res1 = await assetManager.freeBalanceNegativeChallenge(
                [agentTxProof, proof2], agentVault.address, { from: whitelistedAccount });
            expectEvent(res1, 'UnderlyingBalanceTooLow', {agentVault: agentVault.address});
       });
    });

});
