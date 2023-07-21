import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSettings, AssetManagerSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { filterEvents, requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { BNish, MAX_BIPS, randomAddress, toBIPS, toBN, toBNExp, toNumber, toWei } from "../../../../lib/utils/helpers";
import { SourceId } from "../../../../lib/verification/sources/sources";
import { AgentVaultInstance, AssetManagerInstance, ContingencyPoolInstance, ERC20MockInstance, FAssetInstance, WNatInstance } from "../../../../typechain-truffle";
import { TestChainInfo, testChainInfo } from "../../../integration/utils/TestChainInfo";
import { impersonateContract, stopImpersonatingContract } from "../../../utils/contract-test-helpers";
import { newAssetManager } from "../../../utils/fasset/CreateAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestFtsos, TestSettingsContracts, createEncodedTestLiquidationSettings, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings } from "../../../utils/test-settings";


const ContingencyPool = artifacts.require("ContingencyPool");
const RippleAddressValidator = artifacts.require("RippleAddressValidator");

contract(`Redemption.sol; ${getTestFile(__filename)}; Redemption basic tests`, async accounts => {
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
    let chainInfo: TestChainInfo;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;
    let contingencyPool: ContingencyPoolInstance;

    // addresses
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent2 = "Agent2";
    const minterAddress1 = accounts[30];
    const redeemerAddress1 = accounts[40];
    const redeemerAddress2 = accounts[41];
    const underlyingMinter1 = "Minter1";
    const underlyingRedeemer1 = "Redeemer1";
    const underlyingRedeemer2 = "Redeemer2";

    function createAgentVault(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const vaultCollateralToken = options?.vaultCollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings, chain, wallet, attestationProvider }, owner, underlyingAddress, vaultCollateralToken, options);
    }

    async function depositAndMakeAgentAvailable(agentVault: AgentVaultInstance, owner: string, fullAgentCollateral: BN = toWei(3e8)) {
        await depositCollateral(owner, agentVault, fullAgentCollateral);
        await agentVault.buyContingencyPoolTokens({ from: owner, value: fullAgentCollateral });  // add pool collateral and agent pool tokens
        await assetManager.makeAgentAvailable(agentVault.address, { from: owner });
    }

    async function depositCollateral(owner: string, agentVault: AgentVaultInstance, amount: BN, token: ERC20MockInstance = usdc) {
        await token.mintAmount(owner, amount);
        await token.approve(agentVault.address, amount, { from: owner });
        await agentVault.depositCollateral(token.address, amount, { from: owner });
    }

    async function performSelfMintingPayment(agentVault: string, paymentAmount: BNish) {
        const randomAddr = randomAddress();
        chain.mint(randomAddr, paymentAmount);
        return wallet.addTransaction(randomAddr, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVault));
    }

    async function updateUnderlyingBlock() {
        const proof = await attestationProvider.proveConfirmedBlockHeightExists(Number(settings.attestationWindowSeconds));
        await assetManager.updateCurrentBlock(proof);
        return toNumber(proof.blockNumber) + toNumber(proof.numberOfConfirmations);
    }

    async function mintAndRedeem(agentVault: AgentVaultInstance, chain: MockChain, underlyingMinterAddress: string, minterAddress: string, underlyingRedeemerAddress: string, redeemerAddress: string, updateBlock: boolean) {
        // minter
        chain.mint(underlyingMinterAddress, toBNExp(10000, 18));
        if (updateBlock) await updateUnderlyingBlock();
        // perform minting
        const lots = 3;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, { from: minterAddress, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinterAddress, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinterAddress, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress, minted.mintedAmountUBA, { from: minterAddress });
        // redemption request
        const resR = await assetManager.redeem(lots, underlyingRedeemerAddress, { from: redeemerAddress });
        const redemptionRequests = filterEvents(resR, 'RedemptionRequested').map(e => e.args);
        const request = redemptionRequests[0];
        return request;
    }

    async function mintAndRedeemFromAgent(agentVault: AgentVaultInstance, contingencyPool: string, chain: MockChain, underlyingMinterAddress: string, minterAddress: string, underlyingRedeemerAddress: string, redeemerAddress: string, updateBlock: boolean) {
        // minter
        chain.mint(underlyingMinterAddress, toBNExp(10000, 18));
        if (updateBlock) await updateUnderlyingBlock();
        // perform minting
        const lots = 3;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, { from: minterAddress, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinterAddress, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinterAddress, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress, minted.mintedAmountUBA, { from: minterAddress });
        // redemption request
        await impersonateContract(contingencyPool, toBN(512526332000000000), accounts[0]);
        const resR = await assetManager.redeemFromAgent(agentVault.address, redeemerAddress, 1000, underlyingRedeemerAddress, { from: contingencyPool });
        await stopImpersonatingContract(contingencyPool);
        const redemptionRequests = filterEvents(resR, 'RedemptionRequested').map(e => e.args);
        const request = redemptionRequests[0];
        return request;
    }

    async function mintAndRedeemFromAgentInCollateral(agentVault: AgentVaultInstance, contingencyPool: string, chain: MockChain, underlyingMinterAddress: string, minterAddress: string, redeemerAddress: string, updateBlock: boolean) {
        // minter
        chain.mint(underlyingMinterAddress, toBNExp(10000, 18));
        if (updateBlock) await updateUnderlyingBlock();
        // perform minting
        const lots = 3;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, { from: minterAddress, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinterAddress, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinterAddress, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress, minted.mintedAmountUBA, { from: minterAddress });
        // redemption request
        await impersonateContract(contingencyPool, toBN(512526332000000000), accounts[0]);
        const resR = await assetManager.redeemFromAgentInCollateral(agentVault.address, redeemerAddress, 1000000000000, { from: contingencyPool });
        await stopImpersonatingContract(contingencyPool);
    }

    async function initialize() {
        const ci = chainInfo = testChainInfo.eth;
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
        return { contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset };
    }

    beforeEach(async () => {
        ({ contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset } = await loadFixtureCopyVars(initialize));
    });

    it("should confirm redemption payment from agent vault owner", async () => {
        // init
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        //perform redemption payment
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
        let res = await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
        expectEvent(res, 'RedemptionPerformed');
    });

    it("should confirm redemption payment from agent", async () => {
        // init
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        contingencyPool = await ContingencyPool.at(await assetManager.getContingencyPool(agentVault.address));
        const request = await mintAndRedeemFromAgent(agentVault, contingencyPool.address, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        //perform redemption payment
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
        let res = await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
        expectEvent(res, 'RedemptionPerformed');
    });

    it("should confirm redemption payment from agent in collateral", async () => {
        // init
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        contingencyPool = await ContingencyPool.at(await assetManager.getContingencyPool(agentVault.address));
        const vaultCollateralBalanceAgentBefore = await usdc.balanceOf(agentVault.address);
        const vaultCollateralBalanceRedeemerBefore = await usdc.balanceOf(redeemerAddress1);
        await mintAndRedeemFromAgentInCollateral(agentVault, contingencyPool.address, chain, underlyingMinter1, minterAddress1, redeemerAddress1, true);
        //check vault collateral balances
        const vaultCollateralBalanceAgentAfter = await usdc.balanceOf(agentVault.address);
        const vaultCollateralBalanceRedeemerAfter = await usdc.balanceOf(redeemerAddress1);
        assert.equal(vaultCollateralBalanceAgentBefore.sub(vaultCollateralBalanceAgentAfter).toString(), vaultCollateralBalanceRedeemerAfter.sub(vaultCollateralBalanceRedeemerBefore).toString())
    });

    it("should finish redemption payment - payment not from agent's address", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        chain.mint(underlyingAgent2, paymentAmt);
        const tx1Hash = await wallet.addTransaction(underlyingAgent2, request.paymentAddress, paymentAmt, request.paymentReference);
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent2, request.paymentAddress);
        let res = await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
        expectEvent(res, 'RedemptionPerformed');
    });

    it("should not confirm redemption payment - only agent vault owner", async () => {
        // init
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        //perform redemption payment
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
        const resRe = assetManager.confirmRedemptionPayment(proofR, request.requestId);
        await expectRevert(resRe, "only agent vault owner");
    });

    it("should not confirm redemption payment - invalid redemption reference", async () => {
        // init
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        const request2 = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer2, redeemerAddress2, true);
        //perform redemption payment
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
        const resRe = assetManager.confirmRedemptionPayment(proofR, request2.requestId, { from: agentOwner1 });
        await expectRevert(resRe, "invalid redemption reference");
    });

    it("should not confirm redemption payment - payment too old", async () => {
        // init
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        chain.mine(3);  // make some space
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        //perform redemption payment
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        let tx1Hash!: string;
        chain.modifyMinedBlock(Number(request.firstUnderlyingBlock) - 1, block => {
            const tx = wallet.createTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
            block.transactions.push(tx);
            tx1Hash = tx.hash;
        });
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
        const resRe = assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
        await expectRevert(resRe, "redemption payment too old");
    });

    it("should fail redemption payment - already deafulted (should not happen in practice)", async () => {
        // init
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        // trigger default
        chain.mine(chainInfo.underlyingBlocksForPayment + 1);
        chain.skipTimeTo(request.lastUnderlyingTimestamp.toNumber() + 1);
        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        expectEvent(res, 'RedemptionDefault');
        // force a payment in the past
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        let tx1Hash!: string;
        chain.modifyMinedBlock(Number(request.firstUnderlyingBlock) + 1, block => {
            const tx = wallet.createTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
            block.transactions.push(tx);
            tx1Hash = tx.hash;
        });
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
        const resRe = await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
        expectEvent(resRe, 'RedemptionPaymentFailed');
        const resReArgs = requiredEventArgs(resRe, 'RedemptionPaymentFailed');
        assert.equal(resReArgs.failureReason, "redemption payment too late");
    });

    it("should not confirm redemption payment - invalid request id", async () => {
        // init
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        //perform redemption payment
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
        const resRe = assetManager.confirmRedemptionPayment(proofR, 0, { from: agentOwner1 });
        await expectRevert(resRe, "invalid request id");
    });

    it("should not self close - self close of 0", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // perform self-minting
        const lots = 3;
        const randomAddr = randomAddress();
        let val = toBNExp(10000, 18);
        chain.mint(randomAddr, val);
        const transactionHash = await wallet.addTransaction(randomAddr, underlyingAgent1, val, PaymentReference.selfMint(agentVault.address));
        const proof = await attestationProvider.provePayment(transactionHash, null, underlyingAgent1);
        await assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });

        const res = assetManager.selfClose(agentVault.address, 0, { from: agentOwner1 });
        await expectRevert(res, "self close of 0");
    });

    it("should self close", async () => {
        const feeBIPS = toBIPS("10%");
        const poolFeeShareBIPS = toBIPS(0.4);
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1, { feeBIPS, poolFeeShareBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1,toWei(3e8));
        // perform self-minting
        const lots = 3;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        const poolFee = paymentAmount.mul(feeBIPS).divn(MAX_BIPS).mul(poolFeeShareBIPS).divn(MAX_BIPS);
        const transactionHash = await performSelfMintingPayment(agentVault.address, paymentAmount.add(poolFee));
        const proof = await attestationProvider.provePayment(transactionHash, null, underlyingAgent1);
        await assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // withdraw pool f-asset fees to agent vault (so he owns all minted f-assets and can self-close)
        const agentPoolFees = await fAsset.balanceOf(await assetManager.getContingencyPool(agentVault.address));
        await agentVault.withdrawPoolFees(agentPoolFees, agentOwner1, { from: agentOwner1 });
        const agentFassetBalance = await fAsset.balanceOf(agentOwner1);
        let res = await assetManager.selfClose(agentVault.address, agentFassetBalance, { from: agentOwner1 });
        expectEvent(res, "SelfClose")
    });

    it("should execute redemption payment default - redeemer", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        // chain.mine(chainInfo.underlyingBlocksForPayment + 1);
        // chain.skipTimeTo(request.lastUnderlyingTimestamp.toNumber() + 1);
        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        expectEvent(res, 'RedemptionDefault');
    });

    it("should execute redemption payment default - agent", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: agentOwner1 });
        expectEvent(res, 'RedemptionDefault');
    });

    it("should not execute redemption payment default - only redeemer or agent", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: minterAddress1 });
        await expectRevert(res, 'only redeemer or agent');
    });

    it("should not execute redemption payment default - redemption non-payment mismatch", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA,
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        await expectRevert(res, 'redemption non-payment mismatch');
    });

    it("should not execute redemption payment default - invalid redemption status", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        const resReAg = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        await expectRevert(resReAg, "invalid redemption status");
    });

    it("should not execute redemption payment default - redemption non-payment proof window too short", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);

        // const timeIncrease = toBN(settings.timelockSeconds).addn(1);
        // await time.increase(timeIncrease);
        // chain.skipTime(timeIncrease.toNumber());
        // await time.advanceBlock();

        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, false);

        // mine some blocks to create overflow block
        chain.mine(chainInfo.underlyingBlocksForPayment + 1);
        // skip the time until the proofs cannot be made anymore
        chain.skipTime(Number(settings.attestationWindowSeconds) + 1);
        chain.mine();

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber() + 1, request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res =  assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        await expectRevert(res, 'redemption non-payment proof window too short');
    });

    it("should not execute redemption payment default - redemption default too early", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber() - 1, request.lastUnderlyingTimestamp.toNumber() - chainInfo.blockTime);
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: agentOwner1 });
        await expectRevert(res, 'redemption default too early');
    });

    it("should self-mint - multiple tickets", async () => {
        const feeBIPS = toBIPS("10%");
        const poolFeeShareBIPS = toBIPS(0.4);
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1, { feeBIPS, poolFeeShareBIPS });
        const agentVault2 = await createAgentVault(agentOwner2, underlyingAgent2, { feeBIPS, poolFeeShareBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        await depositAndMakeAgentAvailable(agentVault2, agentOwner2);

        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        const poolFee = paymentAmount.mul(feeBIPS).divn(MAX_BIPS).mul(poolFeeShareBIPS).divn(MAX_BIPS);
        const amountWithPoolFee = paymentAmount.add(poolFee);

        const randomAddr = randomAddress();
        chain.mint(randomAddr, amountWithPoolFee);
        const transactionHash1 = await wallet.addTransaction(randomAddr, underlyingAgent2, amountWithPoolFee, PaymentReference.selfMint(agentVault2.address));
        const proof1 = await attestationProvider.provePayment(transactionHash1, null, underlyingAgent2);
        const res1 = await assetManager.selfMint(proof1, agentVault2.address, lots, { from: agentOwner2 });
        expectEvent(res1, "MintingExecuted");

        chain.mint(randomAddr, amountWithPoolFee);
        const transactionHash2 = await wallet.addTransaction(randomAddr, underlyingAgent1, amountWithPoolFee, PaymentReference.selfMint(agentVault.address));
        const proof2 = await attestationProvider.provePayment(transactionHash2, null, underlyingAgent1);
        const res2 = await assetManager.selfMint(proof2, agentVault.address, lots, { from: agentOwner1 });
        expectEvent(res2, "MintingExecuted");

        chain.mint(randomAddr, amountWithPoolFee);
        const transactionHash3 = await wallet.addTransaction(randomAddr, underlyingAgent2, amountWithPoolFee, PaymentReference.selfMint(agentVault2.address));
        const proof3 = await attestationProvider.provePayment(transactionHash3, null, underlyingAgent2);
        const res3 = await assetManager.selfMint(proof3, agentVault2.address, lots, { from: agentOwner2 });
        expectEvent(res3, "MintingExecuted");

        chain.mint(randomAddr, amountWithPoolFee);
        const transactionHash4 = await wallet.addTransaction(randomAddr, underlyingAgent2, amountWithPoolFee, PaymentReference.selfMint(agentVault2.address));
        const proof4 = await attestationProvider.provePayment(transactionHash4, null, underlyingAgent2);
        const res4 = await assetManager.selfMint(proof4, agentVault2.address, lots, { from: agentOwner2 });
        expectEvent(res4, "MintingExecuted");

        const resSelf = await assetManager.selfClose(agentVault.address, paymentAmount, { from: agentOwner1 });
        expectEvent(resSelf, 'SelfClose');
    });

    it("should not execute redemption payment default - non-payment not proved", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const chainId: SourceId = 2;
        stateConnectorClient = new MockStateConnectorClient(contracts.stateConnector, { [chainId]: chain }, 'auto');
        attestationProvider = new AttestationHelper(stateConnectorClient, chain, chainId);
        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: agentOwner1 });
        await expectRevert(res, 'non-payment not proved');
    });

    it("max redeem tickets gas check", async () => {
        //Change maxRedeemedTickets in test-settings.ts or in initialize
        //20 tickets = 492059 gas, 50 tickets = 884188 gas, 100 tickets = 1537804 gas, 200 tickets = 2845226 gas,
        //500 tickets= 6769180 gas, 1000 tickets = 13314728 gas, 2000 = 26426919 gas,
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1,toWei(3e10));
        // minter
        chain.mint(underlyingMinter1, toBNExp(10000000, 18));
        await updateUnderlyingBlock();
        //allLots should be the same as maxRedeemedTickets to create this amount of tickets of 1 lot size
        const allLots = toNumber(settings.maxRedeemedTickets);
        //Mine #allLots number of times with 1 lot
        for (let i = 0; i <= allLots; i++) {
            // perform minting
            const lots = 1;
            const agentInfo = await assetManager.getAgentInfo(agentVault.address);
            const crFee = await assetManager.collateralReservationFee(lots);
            const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, { from: minterAddress1, value: crFee });
            const crt = requiredEventArgs(resAg, 'CollateralReserved');
            const paymentAmount = crt.valueUBA.add(crt.feeUBA);
            const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
            const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
            const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
            const minted = requiredEventArgs(res, 'MintingExecuted');
        }
        // perform minting
        //Mine a large amount then redeem this large amount
        const lots = allLots+200;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, { from: minterAddress1, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress1, minted.mintedAmountUBA, { from: minterAddress1 });
        // redemption request
        const resR = await assetManager.redeem(lots, underlyingRedeemer1, { from: redeemerAddress1 });
        console.log(resR.receipt.gasUsed);
    });

    it("mint and redeem from agent and redeem from agent in collateral branch test", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1,toWei(3e10));
        // minter
        chain.mint(underlyingMinter1, toBNExp(10000000, 18));
        await updateUnderlyingBlock();
        const lots = 1;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, { from: minterAddress1, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress1, minted.mintedAmountUBA, { from: minterAddress1 });
        // redemption request
        contingencyPool = await ContingencyPool.at(await assetManager.getContingencyPool(agentVault.address));
        await impersonateContract(contingencyPool.address, toBN(512526332000000000), accounts[0]);
        //Only contingency pool can redeem from agent
        const rs = assetManager.redeemFromAgent(agentVault.address, redeemerAddress1, 0, underlyingRedeemer1, { from:  accounts[15] });
        await expectRevert(rs, "only contingency pool");
        //Redeeming from agent and agent in collateral with amount 0 should not work
        const resR = assetManager.redeemFromAgent(agentVault.address, redeemerAddress1, 0, underlyingRedeemer1, { from:  contingencyPool.address });
        await expectRevert(resR, "redemption of 0");
        const resRC = assetManager.redeemFromAgentInCollateral(agentVault.address, redeemerAddress1, 0, { from: contingencyPool.address });
        await expectRevert(resRC, "redemption of 0");
        await stopImpersonatingContract(contingencyPool.address);
    });

    it("redeem from agent where minting is done from 2 agents", async () => {
        const agentVault = await createAgentVault(agentOwner1, underlyingAgent1);
        const agentVault2 = await createAgentVault(agentOwner2, underlyingAgent2);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1,toWei(3e10));
        await depositAndMakeAgentAvailable(agentVault2, agentOwner2,toWei(3e10));
        // minter
        chain.mint(underlyingMinter1, toBNExp(10000000, 18));
        await updateUnderlyingBlock();
        //Mint from first agent
        const lots = 1;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, { from: minterAddress1, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        //Mint from second agent
        const agentInfo2 = await assetManager.getAgentInfo(agentVault2.address);
        const crFee2 = await assetManager.collateralReservationFee(lots);
        const resAg2 = await assetManager.reserveCollateral(agentVault2.address, lots, agentInfo2.feeBIPS, { from: minterAddress1, value: crFee2 });
        const crt2 = requiredEventArgs(resAg2, 'CollateralReserved');
        const paymentAmount2 = crt2.valueUBA.add(crt2.feeUBA);
        const txHash2 = await wallet.addTransaction(underlyingMinter1, crt2.paymentAddress, paymentAmount2, crt2.paymentReference);
        const proof2 = await attestationProvider.provePayment(txHash2, underlyingMinter1, crt2.paymentAddress);
        const res2 = await assetManager.executeMinting(proof2, crt2.collateralReservationId, { from: minterAddress1 });
        const minted2 = requiredEventArgs(res2, 'MintingExecuted');
        // redemption request
        contingencyPool = await ContingencyPool.at(await assetManager.getContingencyPool(agentVault.address));
        // make sure contingency pool has enough fAssets
        await fAsset.transfer(contingencyPool.address, minted.mintedAmountUBA, { from: minterAddress1 });
        await fAsset.transfer(contingencyPool.address, minted2.mintedAmountUBA, { from: minterAddress1 });
        await impersonateContract(contingencyPool.address, toBN(512526332000000000), accounts[0]);
        await assetManager.redeemFromAgentInCollateral(agentVault.address, redeemerAddress1, minted.mintedAmountUBA.add(minted2.mintedAmountUBA.div(toBN(2))), { from: contingencyPool.address });
        await stopImpersonatingContract(contingencyPool.address);
    });

    it("mint and redeem address validation", async () => {
        const ci = chainInfo = testChainInfo.eth;
        const rippleAddressValidator = await RippleAddressValidator.new();
        settings.underlyingAddressValidator = rippleAddressValidator.address;
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, createEncodedTestLiquidationSettings());
        const agentXRP = "rfsK8pNsNeGA8nYWM3PzoRxMRHeAyEtNjN";

        const agentVault = await createAgentVault(agentOwner1, agentXRP);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1,toWei(3e10));
        // minter
        chain.mint(underlyingMinter1, toBNExp(10000000, 18));
        await updateUnderlyingBlock();
        const lots = 1;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, { from: minterAddress1, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress1, minted.mintedAmountUBA, { from: minterAddress1 });
        const redeemerXRPAddressCorrect = "rfsK8pNsNeGA8nYWM3PzoRxMRHeAyEtNjN";
        const redeemerXRPAddressTooShort = "rfsK8pNsNeGA8nYWM3PzoRx";
        const redeemerXRPAddressTooLong = "rfsK8pNsNeGA8nYWM3PzoRxMRHeAyEtNjNMRHNFsg";
        const redeemerXRPAddressIncorrect = "rfsk8pNsNeGA8nYWf3PzoRxMRHeAyEtNjN";
        // redemption request, underlying address too short
        let resR = assetManager.redeem(lots, redeemerXRPAddressTooShort, { from: redeemerAddress1 });
        await expectRevert(resR,"invalid underlying address");
        // redemption request, underlying address too long
        resR = assetManager.redeem(lots, redeemerXRPAddressTooLong, { from: redeemerAddress1 });
        await expectRevert(resR,"invalid underlying address");
        // redemption request, underlying address too short
        resR = assetManager.redeem(lots, redeemerXRPAddressIncorrect, { from: redeemerAddress1 });
        await expectRevert(resR,"invalid underlying address");
        // redemption request
        resR = assetManager.redeem(lots, redeemerXRPAddressCorrect, { from: redeemerAddress1 });
        expectEvent(await resR, "RedemptionRequested");
    });
});
