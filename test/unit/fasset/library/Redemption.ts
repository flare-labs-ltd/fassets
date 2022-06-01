import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentVaultInstance, AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { ChainInfo, testChainInfo } from "../../../integration/utils/ChainInfo";
import { filterEvents, findRequiredEvent, requiredEventArgs } from "../../../utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { TX_BLOCKED, TX_FAILED } from "../../../utils/fasset/ChainInterfaces";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { getTestFile, randomAddress, toBN, toBNExp, toNumber, toWei } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../utils/verification/sources/sources";
import { createTestSettings } from "../test-settings";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

contract(`Redemption.sol; ${getTestFile(__filename)}; Redemption basic tests`, async accounts => {
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
    let chainInfo: ChainInfo;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;



    // addresses
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const minterAddress1 = accounts[30];
    const redeemerAddress1 = accounts[40];
    const redeemerAddress2 = accounts[41];
    const underlyingMinter1 = "Minter1";
    const underlyingRedeemer1 = "Redeemer1";
    const underlyingRedeemer2 = "Redeemer2";


    async function createAgent(chain: MockChain, owner: string, underlyingAddress: string) {
        // mint some funds on underlying address (just enough to make EOA proof)
        chain.mint(underlyingAddress, 10001);
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

    async function depositAndMakeAgentAvailable(agentVault: AgentVaultInstance, owner: string) {
        // depositCollateral
        const fullAgentCollateral = toWei(3e8);
        await agentVault.deposit({ from: owner, value: toBN(fullAgentCollateral) });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 2_2000, { from: owner });
    }

    async function mintAndRedeem(agentVault: AgentVaultInstance, chain: MockChain, underlyingMinterAddress: string, minterAddress: string, underlyingRedeemerAddress: string, redeemerAddress: string) {
        // minter
        chain.mint(underlyingMinterAddress, toBNExp(10000, 18));
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


    beforeEach(async () => {
        // create atetstation client
        attestationClient = await AttestationClient.new();
        // create mock chain attestation provider
        chain = new MockChain(await time.latest());
        wallet = new MockChainWallet(chain);
        chainInfo = testChainInfo.eth;
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
    });
    /*
        it("should confirm redemption payment from agent vault owner", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
            //perform redemption payment
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
            const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
            let res = await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
            expectEvent(res, 'RedemptionFinished');
            expectEvent(res, 'RedemptionPerformed');
        });
    
        it("should not confirm redemption payment - only agent vault owner", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
            //perform redemption payment
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
            const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
            const resRe = assetManager.confirmRedemptionPayment(proofR, request.requestId);
            await expectRevert(resRe, "only agent vault owner");
        });
    
        it("should not confirm redemption payment - invalid redemption reference", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
            const request2 = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer2, redeemerAddress2);
            //perform redemption payment
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
            const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
            const resRe = assetManager.confirmRedemptionPayment(proofR, request2.requestId, { from: agentOwner1 });
            await expectRevert(resRe, "invalid redemption reference");
        });
    
        it("should not confirm redemption payment - invalid request id", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
            //perform redemption payment
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
            const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
            const resRe = assetManager.confirmRedemptionPayment(proofR, 0, { from: agentOwner1 });
            await expectRevert(resRe, "invalid request id");
        });
    
        it("should not confirm redemption payment - not redeemer's address - NOT YET", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
            const request2 = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer2, redeemerAddress2);
            //perform redemption payment
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const tx1Hash = await wallet.addTransaction(underlyingAgent1, request2.paymentAddress, paymentAmt, request.paymentReference);
            const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request2.paymentAddress);
            const resRe = await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
            expectEvent(resRe, 'RedemptionFinished');
            expectEvent(resRe, 'RedemptionPaymentFailed');
            const resReAg = assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
            await expectRevert(resReAg, "invalid redemption status");
        });
    
        it("should not confirm redemption payment - invalid redemption status", async () => {
            // init
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
            const request2 = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer2, redeemerAddress2);
            //perform redemption payment
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const tx1Hash = await wallet.addTransaction(underlyingAgent1, request2.paymentAddress, paymentAmt, request.paymentReference);
            const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request2.paymentAddress);
            const resRe = await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
            expectEvent(resRe, 'RedemptionFinished');
            expectEvent(resRe, 'RedemptionPaymentFailed');
            const resReAg = assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
            await expectRevert(resReAg, "invalid redemption status");
        });
    
        it("should not self close - self close of 0", async () => {
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            // perform self-minting
            const lots = 3;
            const randomAddr = randomAddress();
            let val = toBNExp(10000, 18);
            chain.mint(randomAddr, val);
            const transactionHash = await wallet.addTransaction(randomAddr, underlyingAgent1, val, PaymentReference.selfMint(agentVault.address));
            const proof = await attestationProvider.provePayment(transactionHash, null, underlyingAgent1);
            await assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
    
            let res = await assetManager.selfClose(agentVault.address, val, { from: agentOwner1 });
            expectEvent(res, "SelfClose")
        });
    */
    it("should execute redemption payment default - redeemer", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);

        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        const transactionHash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference, { status: TX_FAILED, gasLimit: 10, gasPrice: 10 });
        const proofPay = await attestationProvider.provePayment(transactionHash, underlyingAgent1, request.paymentAddress);
        const resPay = await assetManager.confirmRedemptionPayment(proofPay, request.requestId, { from: agentOwner1 });
        expectEvent(resPay, 'RedemptionFinished');
        expectEvent(resPay, 'RedemptionPaymentFailed');
        for (let i = 0; i <= settings.underlyingBlocksForPayment; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }
        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        expectEvent(res, 'RedemptionDefault');
    });
    /*
        it("should execute redemption payment default - agent", async () => {
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
    
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const transactionHash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference, { status: TX_FAILED, gasLimit: 10, gasPrice: 10 });
            const proofPay = await attestationProvider.provePayment(transactionHash, underlyingAgent1, request.paymentAddress);
            const resPay = await assetManager.confirmRedemptionPayment(proofPay, request.requestId, { from: agentOwner1 });
            expectEvent(resPay, 'RedemptionFinished');
            expectEvent(resPay, 'RedemptionPaymentFailed');
            for (let i = 0; i <= settings.underlyingBlocksForPayment; i++) {
                await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
            }
            const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
            const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: agentOwner1 });
            expectEvent(res, 'RedemptionDefault');
        });
    
        it("should not execute redemption payment default - not agent or redeemer", async () => {
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
    
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const transactionHash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference, { status: TX_FAILED, gasLimit: 10, gasPrice: 10 });
            const proofPay = await attestationProvider.provePayment(transactionHash, underlyingAgent1, request.paymentAddress);
            const resPay = await assetManager.confirmRedemptionPayment(proofPay, request.requestId, { from: agentOwner1 });
            expectEvent(resPay, 'RedemptionFinished');
            expectEvent(resPay, 'RedemptionPaymentFailed');
            for (let i = 0; i <= settings.underlyingBlocksForPayment; i++) {
                await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
            }
            const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
            const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: minterAddress1 });
            await expectRevert(res, 'only redeemer or agent');
        });
    
        it("should not execute redemption payment default - redemption non-payment mismatch", async () => {
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
    
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const transactionHash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference, { status: TX_FAILED, gasLimit: 10, gasPrice: 10 });
            const proofPay = await attestationProvider.provePayment(transactionHash, underlyingAgent1, request.paymentAddress);
            const resPay = await assetManager.confirmRedemptionPayment(proofPay, request.requestId, { from: agentOwner1 });
            expectEvent(resPay, 'RedemptionFinished');
            expectEvent(resPay, 'RedemptionPaymentFailed');
            for (let i = 0; i <= settings.underlyingBlocksForPayment; i++) {
                await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
            }
            const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA, request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
            const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
            await expectRevert(res, 'redemption non-payment mismatch');
        });
    
        it("should not execute redemption payment default - redemption default too early", async () => {
            const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
            await depositAndMakeAgentAvailable(agentVault, agentOwner1);
            const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
    
            const paymentAmt = request.valueUBA.sub(request.feeUBA);
            const transactionHash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference, { status: TX_FAILED, gasLimit: 10, gasPrice: 10 });
            const proofPay = await attestationProvider.provePayment(transactionHash, underlyingAgent1, request.paymentAddress);
            const resPay = await assetManager.confirmRedemptionPayment(proofPay, request.requestId, { from: agentOwner1 });
            expectEvent(resPay, 'RedemptionFinished');
            expectEvent(resPay, 'RedemptionPaymentFailed');
            for (let i = 0; i <= settings.underlyingBlocksForPayment; i++) {
                await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
            }
            const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber()-1, request.lastUnderlyingTimestamp.toNumber());
            const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
            await expectRevert(res, 'redemption default too early');
        });
    */
    // const proof = await this.attestationProvider.proveReferencedPaymentNonexistence(
    //     request.paymentAddress,
    //     request.paymentReference,
    //     request.valueUBA.sub(request.feeUBA),
    //     request.lastUnderlyingBlock.toNumber(),
    //     request.lastUnderlyingTimestamp.toNumber());
    // const res = await this.assetManager.redemptionPaymentDefault(proof, request.requestId, { from: this.ownerAddress });
    // return requiredEventArgs(res, 'RedemptionDefault');
    // it("should not confirm redemption payment - not redeemer's address", async () => {
    //     // init
    //     const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
    //     await depositAndMakeAgentAvailable(agentVault, agentOwner1);
    //     const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1);
    //     //perform redemption payment
    //     const paymentAmt = request.valueUBA.sub(request.feeUBA);
    //     const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference, { status: TX_FAILED});

    //     const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
    //     const resRe = await assetManager.redemptionPaymentDefault(proofR, request.requestId, { from: agentOwner1 });

    //     // findRequiredEvent(resRe, 'RedemptionFinished');
    //     // console.log(requiredEventArgs(resRe, 'RedemptionPaymentFailed'));


    //     // console.log(request)
    //     // console.log("????????")
    //     // console.log(request2)
    //     // console.log("????????")
    //     // console.log(proofR)
    //     // await expectRevert(resRe, "not redeemer's address");
    // });
});

