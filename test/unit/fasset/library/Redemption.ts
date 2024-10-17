import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { filterEvents, requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { BNish, MAX_BIPS, randomAddress, toBIPS, toBN, toBNExp, toNumber, toWei } from "../../../../lib/utils/helpers";
import { AgentVaultInstance, CollateralPoolInstance, ERC20MockInstance, FAssetInstance, IIAssetManagerInstance, WNatInstance } from "../../../../typechain-truffle";
import { TestChainInfo, testChainInfo } from "../../../integration/utils/TestChainInfo";
import { impersonateContract, stopImpersonatingContract } from "../../../utils/contract-test-helpers";
import { AssetManagerInitSettings, newAssetManager } from "../../../utils/fasset/CreateAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestFtsos, TestSettingsContracts, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings } from "../../../utils/test-settings";
import { assertWeb3Equal } from "../../../utils/web3assertions";


const CollateralPool = artifacts.require("CollateralPool");

contract(`Redemption.sol; ${getTestFile(__filename)}; Redemption basic tests`, async accounts => {
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
    let chainInfo: TestChainInfo;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;
    let collateralPool: CollateralPoolInstance;

    // addresses
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent2 = "Agent2";
    const minterAddress1 = accounts[30];
    const redeemerAddress1 = accounts[40];
    const redeemerAddress2 = accounts[41];
    const executorAddress1 = accounts[45];
    const executorAddress2 = accounts[46];
    const underlyingMinter1 = "Minter1";
    const underlyingRedeemer1 = "Redeemer1";
    const underlyingRedeemer2 = "Redeemer2";
    const executorFee = toWei(0.1);

    function createAgent(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const vaultCollateralToken = options?.vaultCollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings, chain, wallet, attestationProvider }, owner, underlyingAddress, vaultCollateralToken, options);
    }

    async function depositAndMakeAgentAvailable(agentVault: AgentVaultInstance, owner: string, fullAgentCollateral: BN = toWei(3e8)) {
        await depositCollateral(owner, agentVault, fullAgentCollateral);
        await agentVault.buyCollateralPoolTokens({ from: owner, value: fullAgentCollateral });  // add pool collateral and agent pool tokens
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
        return toNumber(proof.data.requestBody.blockNumber) + toNumber(proof.data.responseBody.numberOfConfirmations);
    }

    async function mintAndRedeem(agentVault: AgentVaultInstance, chain: MockChain, underlyingMinterAddress: string, minterAddress: string, underlyingRedeemerAddress: string, redeemerAddress: string, updateBlock: boolean, approveCollateralReservation: boolean = false, agentOwner: string = agentOwner1) {
        // minter
        chain.mint(underlyingMinterAddress, toBNExp(10000, 18));
        if (updateBlock) await updateUnderlyingBlock();
        // perform minting
        const lots = 3;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, constants.ZERO_ADDRESS, [], { from: minterAddress, value: crFee });
        let crt;
        if (approveCollateralReservation) {
            const args = requiredEventArgs(resAg, 'HandShakeRequired');
            // approve reservation
            const tx1 = await assetManager.approveCollateralReservation(args.collateralReservationId, { from: agentOwner });
            crt = requiredEventArgs(tx1, 'CollateralReserved');
        } else {
            crt = requiredEventArgs(resAg, 'CollateralReserved');
        }
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinterAddress, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinterAddress, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress, minted.mintedAmountUBA, { from: minterAddress });
        // redemption request
        const resR = await assetManager.redeem(lots, underlyingRedeemerAddress, executorAddress1, { from: redeemerAddress, value: executorFee });
        const redemptionRequests = filterEvents(resR, 'RedemptionRequested').map(e => e.args);
        const request = redemptionRequests[0];
        return request;
    }

    async function mintAndRedeemFromAgent(agentVault: AgentVaultInstance, collateralPool: string, chain: MockChain, underlyingMinterAddress: string, minterAddress: string, underlyingRedeemerAddress: string, redeemerAddress: string, updateBlock: boolean, approveCollateralReservation: boolean = false, agentOwner: string = agentOwner1) {
        // minter
        chain.mint(underlyingMinterAddress, toBNExp(10000, 18));
        if (updateBlock) await updateUnderlyingBlock();
        // perform minting
        const lots = 3;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, constants.ZERO_ADDRESS, [], { from: minterAddress, value: crFee });
        let crt;
        if (approveCollateralReservation) {
            const args = requiredEventArgs(resAg, 'HandShakeRequired');
            // approve reservation
            const tx1 = await assetManager.approveCollateralReservation(args.collateralReservationId, { from: agentOwner });
            crt = requiredEventArgs(tx1, 'CollateralReserved');
        } else {
            crt = requiredEventArgs(resAg, 'CollateralReserved');
        }
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinterAddress, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinterAddress, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress, minted.mintedAmountUBA, { from: minterAddress });
        // redemption request
        await impersonateContract(collateralPool, toBN(512526332000000000), accounts[0]);
        const resR = await assetManager.redeemFromAgent(agentVault.address, redeemerAddress, 1000, underlyingRedeemerAddress, executorAddress1, { from: collateralPool, value: executorFee });
        await stopImpersonatingContract(collateralPool);
        const redemptionRequests = filterEvents(resR, 'RedemptionRequested').map(e => e.args);
        const request = redemptionRequests[0];
        return request;
    }

    async function mintAndRedeemFromAgentInCollateral(agentVault: AgentVaultInstance, collateralPool: string, chain: MockChain, underlyingMinterAddress: string, minterAddress: string, redeemerAddress: string, updateBlock: boolean) {
        // minter
        chain.mint(underlyingMinterAddress, toBNExp(10000, 18));
        if (updateBlock) await updateUnderlyingBlock();
        // perform minting
        const lots = 3;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, constants.ZERO_ADDRESS, [], { from: minterAddress, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinterAddress, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinterAddress, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress, minted.mintedAmountUBA, { from: minterAddress });
        // redemption request
        await impersonateContract(collateralPool, toBN(512526332000000000), accounts[0]);
        const resR = await assetManager.redeemFromAgentInCollateral(agentVault.address, redeemerAddress, 1000000000000, { from: collateralPool });
        await stopImpersonatingContract(collateralPool);
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
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        return { contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset };
    }

    beforeEach(async () => {
        ({ contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset } = await loadFixtureCopyVars(initialize));
    });

    it("should confirm redemption payment from agent vault owner", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        collateralPool = await CollateralPool.at(await assetManager.getCollateralPool(agentVault.address));
        const request = await mintAndRedeemFromAgent(agentVault, collateralPool.address, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        //perform redemption payment
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
        let res = await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
        expectEvent(res, 'RedemptionPerformed');
    });

    it("should confirm redemption payment from agent in collateral", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        collateralPool = await CollateralPool.at(await assetManager.getCollateralPool(agentVault.address));
        const vaultCollateralBalanceAgentBefore = await usdc.balanceOf(agentVault.address);
        const vaultCollateralBalanceRedeemerBefore = await usdc.balanceOf(redeemerAddress1);
        await mintAndRedeemFromAgentInCollateral(agentVault, collateralPool.address, chain, underlyingMinter1, minterAddress1, redeemerAddress1, true);
        //check vault collateral balances
        const vaultCollateralBalanceAgentAfter = await usdc.balanceOf(agentVault.address);
        const vaultCollateralBalanceRedeemerAfter = await usdc.balanceOf(redeemerAddress1);
        assert.equal(vaultCollateralBalanceAgentBefore.sub(vaultCollateralBalanceAgentAfter).toString(), vaultCollateralBalanceRedeemerAfter.sub(vaultCollateralBalanceRedeemerBefore).toString())
    });

    it("should finish redemption payment - payment not from agent's address", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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

    it("should fail redemption payment - already defaulted (should not happen in practice)", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS, poolFeeShareBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1, toWei(3e8));
        // perform self-minting
        const lots = 3;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        const poolFee = paymentAmount.mul(feeBIPS).divn(MAX_BIPS).mul(poolFeeShareBIPS).divn(MAX_BIPS);
        const transactionHash = await performSelfMintingPayment(agentVault.address, paymentAmount.add(poolFee));
        const proof = await attestationProvider.provePayment(transactionHash, null, underlyingAgent1);
        await assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // withdraw pool f-asset fees to agent vault (so he owns all minted f-assets and can self-close)
        const agentPoolFees = await fAsset.balanceOf(await assetManager.getCollateralPool(agentVault.address));
        await agentVault.withdrawPoolFees(agentPoolFees, agentOwner1, { from: agentOwner1 });
        const agentFassetBalance = await fAsset.balanceOf(agentOwner1);
        let res = await assetManager.selfClose(agentVault.address, agentFassetBalance, { from: agentOwner1 });
        expectEvent(res, "SelfClose")
    });

    it("should execute redemption payment default - redeemer", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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

    it("should execute redemption payment default - executor", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        // chain.mine(chainInfo.underlyingBlocksForPayment + 1);
        // chain.skipTimeTo(request.lastUnderlyingTimestamp.toNumber() + 1);
        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const executorBalanceStart = toBN(await web3.eth.getBalance(executorAddress1));
        const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: executorAddress1 });
        const executorBalanceEnd = toBN(await web3.eth.getBalance(executorAddress1));
        const gasFee = toBN(res.receipt.gasUsed).mul(toBN(res.receipt.effectiveGasPrice));
        expectEvent(res, 'RedemptionDefault');
        assertWeb3Equal(executorBalanceEnd.sub(executorBalanceStart), executorFee.sub(gasFee));
    });

    it("should execute redemption payment default - agent", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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

    it("should not execute redemption payment default - only redeemer, executor or agent", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: minterAddress1 });
        await expectRevert(res, 'only redeemer, executor or agent');
    });

    it("should not execute redemption payment default - redemption non-payment mismatch", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        await expectRevert(res, 'redemption non-payment proof window too short');
    });

    it("should not execute redemption payment default - redemption default too early", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS, poolFeeShareBIPS });
        const agentVault2 = await createAgent(agentOwner2, underlyingAgent2, { feeBIPS, poolFeeShareBIPS });
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
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }
        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        proof.data.responseBody.firstOverflowBlockNumber = toBN(proof.data.responseBody.firstOverflowBlockNumber).addn(1).toString();
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: agentOwner1 });
        await expectRevert(res, 'non-payment not proved');
    });

    it("max redeem tickets gas check", async () => {
        //Change maxRedeemedTickets in test-settings.ts or in initialize
        //20 tickets = 492059 gas, 50 tickets = 884188 gas, 100 tickets = 1537804 gas, 200 tickets = 2845226 gas,
        //500 tickets= 6769180 gas, 1000 tickets = 13314728 gas, 2000 = 26426919 gas,
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1, toWei(3e10));
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
            const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, constants.ZERO_ADDRESS, [], { from: minterAddress1, value: crFee });
            const crt = requiredEventArgs(resAg, 'CollateralReserved');
            const paymentAmount = crt.valueUBA.add(crt.feeUBA);
            const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
            const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
            const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
            const minted = requiredEventArgs(res, 'MintingExecuted');
        }
        // perform minting
        //Mine a large amount then redeem this large amount
        const lots = allLots + 200;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, constants.ZERO_ADDRESS, [], { from: minterAddress1, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress1, minted.mintedAmountUBA, { from: minterAddress1 });
        // redemption request
        const resR = await assetManager.redeem(lots, underlyingRedeemer1, executorAddress1, { from: redeemerAddress1, value: executorFee });
        console.log(resR.receipt.gasUsed);
    });

    it("mint and redeem from agent and redeem from agent in collateral branch test", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1, toWei(3e10));
        // minter
        chain.mint(underlyingMinter1, toBNExp(10000000, 18));
        await updateUnderlyingBlock();
        const lots = 1;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, constants.ZERO_ADDRESS, [], { from: minterAddress1, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        // redeemer "buys" f-assets
        await fAsset.transfer(redeemerAddress1, minted.mintedAmountUBA, { from: minterAddress1 });
        // redemption request
        collateralPool = await CollateralPool.at(await assetManager.getCollateralPool(agentVault.address));
        await impersonateContract(collateralPool.address, toBN(512526332000000000), accounts[0]);
        //Only collateral pool can redeem from agent
        const rs = assetManager.redeemFromAgent(agentVault.address, redeemerAddress1, 0, underlyingRedeemer1, constants.ZERO_ADDRESS, { from: accounts[15] });
        await expectRevert(rs, "only collateral pool");
        //Redeeming from agent and agent in collateral with amount 0 should not work
        const resR = assetManager.redeemFromAgent(agentVault.address, redeemerAddress1, 0, underlyingRedeemer1, constants.ZERO_ADDRESS, { from: collateralPool.address });
        await expectRevert(resR, "redemption of 0");
        const resRC = assetManager.redeemFromAgentInCollateral(agentVault.address, redeemerAddress1, 0, { from: collateralPool.address });
        await expectRevert(resRC, "redemption of 0");
        await stopImpersonatingContract(collateralPool.address);
    });

    it("redeem from agent where minting is done from 2 agents", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const agentVault2 = await createAgent(agentOwner2, underlyingAgent2);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1, toWei(3e10));
        await depositAndMakeAgentAvailable(agentVault2, agentOwner2, toWei(3e10));
        // minter
        chain.mint(underlyingMinter1, toBNExp(10000000, 18));
        await updateUnderlyingBlock();
        //Mint from first agent
        const lots = 1;
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        const crFee = await assetManager.collateralReservationFee(lots);
        const resAg = await assetManager.reserveCollateral(agentVault.address, lots, agentInfo.feeBIPS, constants.ZERO_ADDRESS, [], { from: minterAddress1, value: crFee });
        const crt = requiredEventArgs(resAg, 'CollateralReserved');
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        const minted = requiredEventArgs(res, 'MintingExecuted');
        //Mint from second agent
        const agentInfo2 = await assetManager.getAgentInfo(agentVault2.address);
        const crFee2 = await assetManager.collateralReservationFee(lots);
        const resAg2 = await assetManager.reserveCollateral(agentVault2.address, lots, agentInfo2.feeBIPS, constants.ZERO_ADDRESS, [], { from: minterAddress1, value: crFee2 });
        const crt2 = requiredEventArgs(resAg2, 'CollateralReserved');
        const paymentAmount2 = crt2.valueUBA.add(crt2.feeUBA);
        const txHash2 = await wallet.addTransaction(underlyingMinter1, crt2.paymentAddress, paymentAmount2, crt2.paymentReference);
        const proof2 = await attestationProvider.provePayment(txHash2, underlyingMinter1, crt2.paymentAddress);
        const res2 = await assetManager.executeMinting(proof2, crt2.collateralReservationId, { from: minterAddress1 });
        const minted2 = requiredEventArgs(res2, 'MintingExecuted');
        // redemption request
        collateralPool = await CollateralPool.at(await assetManager.getCollateralPool(agentVault.address));
        // make sure collateral pool has enough fAssets
        await fAsset.transfer(collateralPool.address, minted.mintedAmountUBA, { from: minterAddress1 });
        await fAsset.transfer(collateralPool.address, minted2.mintedAmountUBA, { from: minterAddress1 });
        await impersonateContract(collateralPool.address, toBN(512526332000000000), accounts[0]);
        await assetManager.redeemFromAgentInCollateral(agentVault.address, redeemerAddress1, minted.mintedAmountUBA.add(minted2.mintedAmountUBA.div(toBN(2))), { from: collateralPool.address });
        await stopImpersonatingContract(collateralPool.address);
    });

    it("mint and redeem with address validation - invalid address", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const agentInfo1 = await assetManager.getAgentInfo(agentVault.address);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, "MY_INVALID_ADDRESS", redeemerAddress1, true);
        const agentInfo2 = await assetManager.getAgentInfo(agentVault.address);
        assert.equal(Number(agentInfo2.freeCollateralLots), Number(agentInfo1.freeCollateralLots) - 3);
        const proof = await attestationProvider.proveAddressValidity(request.paymentAddress);
        assert.isFalse(proof.data.responseBody.isValid);
        const res = await assetManager.rejectInvalidRedemption(proof, request.requestId, { from: agentOwner1 });
        expectEvent(res, 'RedemptionRejected', { requestId: request.requestId, redemptionAmountUBA: request.valueUBA });
        const agentInfo3 = await assetManager.getAgentInfo(agentVault.address);
        assert.equal(Number(agentInfo3.freeCollateralLots), Number(agentInfo1.freeCollateralLots));
    });

    it("mint and redeem with address validation - address not normalized", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const agentInfo1 = await assetManager.getAgentInfo(agentVault.address);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, "  NOT_NORMALIZED_ADDRESS  ", redeemerAddress1, true);
        const agentInfo2 = await assetManager.getAgentInfo(agentVault.address);
        assert.equal(Number(agentInfo2.freeCollateralLots), Number(agentInfo1.freeCollateralLots) - 3);
        const proof = await attestationProvider.proveAddressValidity(request.paymentAddress);
        assert.isTrue(proof.data.responseBody.isValid);
        const res = await assetManager.rejectInvalidRedemption(proof, request.requestId, { from: agentOwner1 });
        expectEvent(res, 'RedemptionRejected', { requestId: request.requestId, redemptionAmountUBA: request.valueUBA });
        const agentInfo3 = await assetManager.getAgentInfo(agentVault.address);
        assert.equal(Number(agentInfo3.freeCollateralLots), Number(agentInfo1.freeCollateralLots));
    });

    it("mint and redeem with address validation - valid address", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const agentInfo1 = await assetManager.getAgentInfo(agentVault.address);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, "AGENT_ADDRESS", redeemerAddress1, true);
        const agentInfo2 = await assetManager.getAgentInfo(agentVault.address);
        assert.equal(Number(agentInfo2.freeCollateralLots), Number(agentInfo1.freeCollateralLots) - 3);
        const proof = await attestationProvider.proveAddressValidity(request.paymentAddress);
        assert.isTrue(proof.data.responseBody.isValid);
        const promise = assetManager.rejectInvalidRedemption(proof, request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "address valid");
        const agentInfo3 = await assetManager.getAgentInfo(agentVault.address);
        assert.equal(Number(agentInfo3.freeCollateralLots), Number(agentInfo1.freeCollateralLots) - 3);
    });

    it("mint and redeem with address validation - only owner", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, "MY_INVALID_ADDRESS", redeemerAddress1, true);
        const proof = await attestationProvider.proveAddressValidity(request.paymentAddress);
        assert.isFalse(proof.data.responseBody.isValid);
        await expectRevert(assetManager.rejectInvalidRedemption(proof, request.requestId, { from: accounts[0] }),
            "only agent vault owner");
    });

    it("mint and redeem with address validation - wrong challenged address", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, "AGENT_ADDRESS", redeemerAddress1, true);
        const proof = await attestationProvider.proveAddressValidity("SOME_INVALID_ADDRESS");
        assert.isFalse(proof.data.responseBody.isValid);
        await expectRevert(assetManager.rejectInvalidRedemption(proof, request.requestId, { from: agentOwner1 }),
            "wrong address");
    });

    it("should reject redemption request", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        // reject redemption request
        const res = await assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        // check
        const args = requiredEventArgs(res, 'RedemptionRequestRejected');
        assertWeb3Equal(args.requestId, request.requestId);
        assertWeb3Equal(args.agentVault, agentVault.address);
        assertWeb3Equal(args.redeemer, redeemerAddress1);
    });

    it("should not reject redemption request - hand-shake disabled", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 0 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        // reject redemption request
        const promise = assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "hand-shake disabled");
    });

    it("should not reject redemption request - request is not active", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);

        // mine blocks in which underlying assets were not redeemed
        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        expectEvent(res, 'RedemptionDefault');

        // try to reject redemption request
        const promise = assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "not active");
    });

    it("should not reject redemption request - only owner", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        const promise = assetManager.rejectRedemptionRequest(request.requestId);
        await expectRevert(promise, "only agent vault owner");
    });

    it("should not reject redemption request - request window closed", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        // move time to close the rejection request window
        await time.increase(Number(settings.rejectRedemptionRequestWindowSeconds));
        const promise = assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "reject redemption request window closed");
    });

    it("should reject redemption request - pool self close", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        collateralPool = await CollateralPool.at(await assetManager.getCollateralPool(agentVault.address));
        // mint and redeem from agent
        const request = await mintAndRedeemFromAgent(agentVault, collateralPool.address, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        // reject redemption request
        const burnAddressBalance = await web3.eth.getBalance(settings.burnAddress);
        const tx = await assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        expectEvent(tx, 'RedemptionDefault');
        const burnAddressBalanceAfter = await web3.eth.getBalance(settings.burnAddress);
        assertWeb3Equal(toBN(burnAddressBalanceAfter).sub(toBN(burnAddressBalance)), request.executorFeeNatWei);
        // redemption request should be deleted
        const promise = assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "invalid request id");
    });

    it("should not confirm redemption payment if redemption is rejected", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        // reject redemption request
        const res = await assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        // try to perform redemption payment
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
        let promise = assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "rejected redemption cannot be confirmed");
    });

    it("should revert rejected redemption payment default - redemption not rejected", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        // try to perform rejected redemption default payment
        const promise = assetManager.rejectedRedemptionPaymentDefault(request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "only rejected redemption");
    });

    it("should revert rejected redemption payment default - invalid redemption status", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        // mine blocks in which underlying assets were not redeemed
        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }
        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        //  will change redemption status to defaulted
        const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        expectEvent(res, 'RedemptionDefault');

        // try to perform rejected redemption default payment
        const promise = assetManager.rejectedRedemptionPaymentDefault(request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "invalid redemption status");
    });

    it("should revert rejected redemption payment default - too early", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        // reject redemption request
        const res = await assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        const args = requiredEventArgs(res, 'RedemptionRequestRejected');
        // try to perform rejected redemption default payment
        const promise = assetManager.rejectedRedemptionPaymentDefault(request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "rejected redemption default too early");
    });

    it("should revert rejected redemption payment default - only redeemer, executor or agent", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        // reject redemption request
        const res = await assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        const args = requiredEventArgs(res, 'RedemptionRequestRejected');
        // move for take over request window
        await time.increase(Number(settings.takeOverRedemptionRequestWindowSeconds));
        // try to perform rejected redemption default payment
        const promise = assetManager.rejectedRedemptionPaymentDefault(request.requestId, { from: accounts[987] });
        await expectRevert(promise, "only redeemer, executor or agent");
    });

    it("should executed default payment if redemption is rejected", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        // reject redemption request
        const res = await assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        requiredEventArgs(res, 'RedemptionRequestRejected');
        // move for take over request window
        await time.increase(Number(settings.takeOverRedemptionRequestWindowSeconds));
        // try to perform rejected redemption default payment
        const burnAddressBalance = await web3.eth.getBalance(settings.burnAddress);
        const tx = await assetManager.rejectedRedemptionPaymentDefault(request.requestId, { from: agentOwner1 });
        expectEvent(tx, 'RedemptionDefault');
        // executor fee should be burned
        const burnAddressBalanceAfter = await web3.eth.getBalance(settings.burnAddress);
        assertWeb3Equal(toBN(burnAddressBalanceAfter).sub(toBN(burnAddressBalance)), request.executorFeeNatWei);
        // redemption request should be deleted
        const promise = assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "invalid request id");
    });

    it("should executed default payment if redemption is rejected - executor executes", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);
        // reject redemption request
        const res = await assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        requiredEventArgs(res, 'RedemptionRequestRejected');
        // move for take over request window
        await time.increase(Number(settings.takeOverRedemptionRequestWindowSeconds));
        // try to perform rejected redemption default payment
        const burnAddressBalance = await web3.eth.getBalance(settings.burnAddress);
        const executorBalanceBefore = await web3.eth.getBalance(executorAddress1);
        const tx = await assetManager.rejectedRedemptionPaymentDefault(request.requestId, { from: executorAddress1 });
        expectEvent(tx, 'RedemptionDefault');
        // executor fee should be sent to executor
        const burnAddressBalanceAfter = await web3.eth.getBalance(settings.burnAddress);
        assertWeb3Equal(toBN(burnAddressBalanceAfter).sub(toBN(burnAddressBalance)), 0);
        const executorBalanceAfter = await web3.eth.getBalance(executorAddress1);
        assertWeb3Equal(toBN(executorBalanceAfter).sub(toBN(executorBalanceBefore)), request.executorFeeNatWei.sub(toBN(tx.receipt.gasUsed).mul(toBN(tx.receipt.effectiveGasPrice))));
        // redemption request should be deleted
        const promise = assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "invalid request id");
    });

    it("should revert take over redemption request - redemption request not active", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);

        // mine blocks in which underlying assets were not redeemed
        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA),
            request.firstUnderlyingBlock.toNumber(), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        expectEvent(res, 'RedemptionDefault');

        // try to reject redemption request
        const promise = assetManager.takeOverRedemptionRequest(agentVault.address, request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "not active");
    });

    it("should revert take over redemption request - only agent owner", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);

        // try to reject redemption request
        const promise = assetManager.takeOverRedemptionRequest(agentVault.address, request.requestId, { from: accounts[0] });
        await expectRevert(promise, "only agent vault owner");
    });

    it("should revert take over redemption request - not rejected", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);

        // try to reject redemption request
        const promise = assetManager.takeOverRedemptionRequest(agentVault.address, request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "not rejected");
    });

    it("should revert take over redemption request - request window closed", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);

        // reject redemption request
        const res = await assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        requiredEventArgs(res, 'RedemptionRequestRejected');

        // move time to close the rejection request window
        await time.increase(Number(settings.rejectRedemptionRequestWindowSeconds));

        // try to take over redemption request
        const promise = assetManager.takeOverRedemptionRequest(agentVault.address, request.requestId, { from: agentOwner1 });
        await expectRevert(promise, "take over redemption request window closed");
    });

    it("should revert take over redemption request - no tickets", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true, true, agentOwner1);

        // reject redemption request
        const res = await assetManager.rejectRedemptionRequest(request.requestId, { from: agentOwner1 });
        requiredEventArgs(res, 'RedemptionRequestRejected');

        const agentVault2 = await createAgent(agentOwner2, underlyingAgent2, { handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault2, agentOwner2);
        // agent 2 didn't mint anything yet - has no tickets
        const promise = assetManager.takeOverRedemptionRequest(agentVault2.address, request.requestId, { from: agentOwner2 });
        await expectRevert(promise, "no tickets");
    });


});
