import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentVaultInstance, AssetManagerInstance, AttestationClientSCInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, StateConnectorMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { TestChainInfo, testChainInfo } from "../../../integration/utils/TestChainInfo";
import { filterEvents, findRequiredEvent, requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { AssetManagerSettings } from "../../../../lib/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { newAssetManager } from "../../../../lib/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { randomAddress, toBN, toBNExp, toNumber, toWei } from "../../../../lib/utils/helpers";
import { getTestFile } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../../lib/verification/sources/sources";
import { createTestSettings } from "../test-settings";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientSC');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const StateConnector = artifacts.require('StateConnectorMock');
const AgentVaultFactory = artifacts.require('AgentVaultFactory');

contract(`Redemption.sol; ${getTestFile(__filename)}; Redemption basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let attestationClient: AttestationClientSCInstance;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wnat: WNatInstance;
    let ftsoRegistry: FtsoRegistryMockInstance;
    let natFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    let settings: AssetManagerSettings;
    const chainId: SourceId = 1;
    let chain: MockChain;
    let chainInfo: TestChainInfo;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;
    let stateConnector: StateConnectorMockInstance;

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

    async function updateUnderlyingBlock() {
        const proof = await attestationProvider.proveConfirmedBlockHeightExists();
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


    beforeEach(async () => {
        // create state connector
        stateConnector = await StateConnector.new();
        // create agent vault factory
        const agentVaultFactory = await AgentVaultFactory.new();
        // create atetstation client
        attestationClient = await AttestationClient.new(stateConnector.address);
        // create mock chain attestation provider
        chain = new MockChain(await time.latest());
        chainInfo = testChainInfo.eth;
        chain.secondsPerBlock = chainInfo.blockTime;
        wallet = new MockChainWallet(chain);
        stateConnectorClient = new MockStateConnectorClient(stateConnector, { [chainId]: chain }, 'auto');
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
        settings = createTestSettings(agentVaultFactory, attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings);
    });

    it("should confirm redemption payment from agent vault owner", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        //perform redemption payment
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        const tx1Hash = await wallet.addTransaction(underlyingAgent1, request.paymentAddress, paymentAmt, request.paymentReference);
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent1, request.paymentAddress);
        let res = await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
        expectEvent(res, 'RedemptionFinished');
        expectEvent(res, 'RedemptionPerformed');
    });

    it("should finish redemption payment - payment not from agent's address", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);
        
        const paymentAmt = request.valueUBA.sub(request.feeUBA);
        chain.mint(underlyingAgent2, paymentAmt);
        const tx1Hash = await wallet.addTransaction(underlyingAgent2, request.paymentAddress, paymentAmt, request.paymentReference);
        const proofR = await attestationProvider.provePayment(tx1Hash, underlyingAgent2, request.paymentAddress);
        let res = await assetManager.confirmRedemptionPayment(proofR, request.requestId, { from: agentOwner1 });
        await expectEvent(res, 'RedemptionFinished');
    });

    it("should not confirm redemption payment - only agent vault owner", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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

    it("should not confirm redemption payment - invalid request id", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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

    it("should execute redemption payment default - redeemer", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 2; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        expectEvent(res, 'RedemptionDefault');
    });

    it("should execute redemption payment default - agent", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 2; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: agentOwner1 });
        expectEvent(res, 'RedemptionDefault');
    });

    it("should not execute redemption payment default - only redeemer or agent", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 2; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: minterAddress1 });
        await expectRevert(res, 'only redeemer or agent');
    });

    it("should not execute redemption payment default - redemption non-payment mismatch", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 2; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA, request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        await expectRevert(res, 'redemption non-payment mismatch');
    });

    it("should not execute redemption payment default - invalid redemption status", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 2; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        await assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        const resReAg = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        await expectRevert(resReAg, "invalid redemption status");
    });

    it("should not execute redemption payment default - redemption request too old", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);

        const timeIncrease = toBN(settings.timelockSeconds).addn(1);
        await time.increase(timeIncrease);
        chain.skipTime(timeIncrease.toNumber());
        await time.advanceBlock();

        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, false);

        // mine some blocks to create overflow block
        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment + 1; i++) {
            chain.mine();
        }
        // skip the time until the proofs cannot be made anymore
        chain.skipTime(stateConnectorClient.queryWindowSeconds);
        chain.mine();

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res =  assetManager.redemptionPaymentDefault(proof, request.requestId, { from: redeemerAddress1 });
        await expectRevert(res, 'redemption request too old');
    });

    it("should not execute redemption payment default - redemption default too early", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 2; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber() - 1, request.lastUnderlyingTimestamp.toNumber() - chainInfo.blockTime);
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: agentOwner1 });
        await expectRevert(res, 'redemption default too early');
    });

    it("should self-mint - multiple tickets", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const agentVault2 = await createAgent(chain, agentOwner2, underlyingAgent2);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        await depositAndMakeAgentAvailable(agentVault2, agentOwner2);

        const lots = 2;
        let amt = toBN(lots).mul(toBN(settings.lotSizeAMG)); // in amg
        let amount = toBN(amt).mul(toBN(settings.assetMintingGranularityUBA)); // in uba

        const randomAddr = randomAddress();
        chain.mint(randomAddr, amount);
        const transactionHash1 = await wallet.addTransaction(randomAddr, underlyingAgent2, amount, PaymentReference.selfMint(agentVault2.address));
        const proof1 = await attestationProvider.provePayment(transactionHash1, null, underlyingAgent2);
        const res1 = await assetManager.selfMint(proof1, agentVault2.address, lots, { from: agentOwner2 });
        expectEvent(res1, "MintingExecuted");

        chain.mint(randomAddr, amount);
        const transactionHash2 = await wallet.addTransaction(randomAddr, underlyingAgent1, amount, PaymentReference.selfMint(agentVault.address));
        const proof2 = await attestationProvider.provePayment(transactionHash2, null, underlyingAgent1);
        const res2 = await assetManager.selfMint(proof2, agentVault.address, lots, { from: agentOwner1 });
        expectEvent(res2, "MintingExecuted");

        chain.mint(randomAddr, amount);
        const transactionHash3 = await wallet.addTransaction(randomAddr, underlyingAgent2, amount, PaymentReference.selfMint(agentVault2.address));
        const proof3 = await attestationProvider.provePayment(transactionHash3, null, underlyingAgent2);
        const res3 = await assetManager.selfMint(proof3, agentVault2.address, lots, { from: agentOwner2 });
        expectEvent(res3, "MintingExecuted");

        chain.mint(randomAddr, amount);
        const transactionHash4 = await wallet.addTransaction(randomAddr, underlyingAgent2, amount, PaymentReference.selfMint(agentVault2.address));
        const proof4 = await attestationProvider.provePayment(transactionHash4, null, underlyingAgent2);
        const res4 = await assetManager.selfMint(proof4, agentVault2.address, lots, { from: agentOwner2 });
        expectEvent(res4, "MintingExecuted");

        const resSelf = await assetManager.selfClose(agentVault.address, amount, { from: agentOwner1 });
        expectEvent(resSelf, 'SelfClose');
    });

    it("should not execute redemption payment default - non-payment not proved", async () => {
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const request = await mintAndRedeem(agentVault, chain, underlyingMinter1, minterAddress1, underlyingRedeemer1, redeemerAddress1, true);

        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 2; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }

        const chainId: SourceId = 2;
        stateConnectorClient = new MockStateConnectorClient(stateConnector, { [chainId]: chain }, 'auto');
        attestationProvider = new AttestationHelper(stateConnectorClient, chain, chainId, 0);
        const proof = await attestationProvider.proveReferencedPaymentNonexistence(request.paymentAddress, request.paymentReference, request.valueUBA.sub(request.feeUBA), request.lastUnderlyingBlock.toNumber(), request.lastUnderlyingTimestamp.toNumber());
        const res = assetManager.redemptionPaymentDefault(proof, request.requestId, { from: agentOwner1 });
        await expectRevert(res, 'non-payment not proved');
    });

});
