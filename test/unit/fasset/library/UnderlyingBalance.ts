import { expectRevert, time } from "@openzeppelin/test-helpers";
import { ethers } from "hardhat";
import { AgentSettings, AssetManagerSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { findRequiredEvent } from "../../../../lib/utils/events/truffle";
import { randomAddress } from "../../../../lib/utils/helpers";
import { AssetManagerInstance, ERC20MockInstance, FAssetInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../../utils/test-helpers";
import { createEncodedTestLiquidationSettings, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings, TestFtsos, TestSettingsContracts } from "../test-settings";
import { precomputeContractAddress } from "../../../utils/contract-test-helpers";

contract(`UnderlyingBalance.sol; ${getTestFile(__filename)};  UnderlyingBalance unit tests`, async accounts => {

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

    // addresses
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingRandomAddress = "Random";

    function createAgent(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const class1CollateralToken = options?.class1CollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings, chain, wallet, attestationProvider }, owner, underlyingAddress, class1CollateralToken, options);
    }

    beforeEach(async () => {
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
    });

    it("should confirm top up payment", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingRandomAddress,1000);
        let txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, 500, PaymentReference.topup(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        await assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });
    });

    it("should reject confirmation of top up payment if payment is negative", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingRandomAddress,1000);
        chain.mint(underlyingAgent1,1000);
        let txHash = await wallet.addMultiTransaction({[underlyingAgent1]: 500, [underlyingRandomAddress]: 100}, {[underlyingAgent1]: 450, [underlyingRandomAddress]: 0}, PaymentReference.topup(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        await expectRevert(assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 }), "SafeCast: value must be positive");
        const proofIllegal = await attestationProvider.proveBalanceDecreasingTransaction(txHash, underlyingAgent1);
        const res = await assetManager.illegalPaymentChallenge(proofIllegal, agentVault.address);
        findRequiredEvent(res, 'IllegalPaymentConfirmed');
        findRequiredEvent(res, 'FullLiquidationStarted');
    });

    it("should reject confirmation of top up payment - not underlying address", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        let txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingRandomAddress, 500, PaymentReference.topup(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingRandomAddress);
        let res = assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });
        await expectRevert(res, 'not underlying address');
    });
    it("should reject confirmation of top up payment - not a topup payment", async () => {
        chain.mint(underlyingRandomAddress,1000);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        let txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, 500, PaymentReference.topup(randomAddress()));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        let res = assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });
        await expectRevert(res, 'not a topup payment');
    });
    it("should reject confirmation of top up payment - topup before agent created", async () => {
        chain.mint(underlyingRandomAddress,1000);
        let agentVaultAddressCalc = precomputeContractAddress(contracts.agentVaultFactory.address, 1);
        let txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, 500, PaymentReference.topup(agentVaultAddressCalc));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        let res =  assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });
        await expectRevert(res, 'topup before agent created');
    });
});
