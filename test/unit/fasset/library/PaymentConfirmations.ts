import { expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSettings, AssetManagerSettings, CollateralToken } from "../../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { DAYS } from "../../../../lib/utils/helpers";
import { AgentVaultInstance, AssetManagerInstance, ERC20MockInstance, FAssetInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../../utils/test-helpers";
import { createEncodedTestLiquidationSettings, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings, TestFtsos, TestSettingsContracts } from "../test-settings";

contract(`PaymentConfirmations.sol; ${getTestFile(__filename)}; PaymentConfirmations basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let contracts: TestSettingsContracts;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wNat: WNatInstance;
    let usdc: ERC20MockInstance;
    let ftsos: TestFtsos;
    let settings: AssetManagerSettings;
    let collaterals: CollateralToken[];
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;

    // addresses
    const agentOwner1 = accounts[20];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingRandomAddress = "Random";

    function createAgent(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const class1CollateralToken = options?.class1CollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings, chain, wallet, attestationProvider }, owner, underlyingAddress, class1CollateralToken, options);
    }

    async function agentTopup(agentVault: AgentVaultInstance){
        chain.mint(underlyingRandomAddress, 1);
        let txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, 1, PaymentReference.topup(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        await assetManager.confirmTopupPayment(proof, agentVault.address, { from: agentOwner1 });
        return proof;
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
        collaterals = createTestCollaterals(contracts);
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, createEncodedTestLiquidationSettings());
    });

    it("should cleanup payment verifications after 15 days", async () => {
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const proof1 = await agentTopup(agentVault);
        // make transaction in the "future" (chains timestamp may differ)
        chain.skipTime(15 * DAYS);
        const proof2 = await agentTopup(agentVault);
        // it should revert confirming twice
        await expectRevert(assetManager.confirmTopupPayment(proof1, agentVault.address, { from: agentOwner1 }), "payment already confirmed");
        await expectRevert(assetManager.confirmTopupPayment(proof2, agentVault.address, { from: agentOwner1 }), "payment already confirmed");
        // after 15 days it should cleanup old payment verifications
        await time.increase(15 * DAYS);
        await agentTopup(agentVault);
        await agentTopup(agentVault);
        await expectRevert(assetManager.confirmTopupPayment(proof1, agentVault.address, { from: agentOwner1 }), "verified transaction too old");
        await assetManager.confirmTopupPayment(proof2, agentVault.address, { from: agentOwner1 });
        // skipping one more day
        await time.increase(DAYS);
        chain.skipTime(DAYS);
        await agentTopup(agentVault);
        await expectRevert(assetManager.confirmTopupPayment(proof1, agentVault.address, { from: agentOwner1 }), "verified transaction too old");
        await expectRevert(assetManager.confirmTopupPayment(proof2, agentVault.address, { from: agentOwner1 }), "payment already confirmed");
        // after 15 days it should cleanup old payment verifications
        await time.increase(15 * DAYS);
        chain.skipTime(15 * DAYS);
        await agentTopup(agentVault);
        await expectRevert(assetManager.confirmTopupPayment(proof1, agentVault.address, { from: agentOwner1 }), "verified transaction too old");
        await expectRevert(assetManager.confirmTopupPayment(proof2, agentVault.address, { from: agentOwner1 }), "verified transaction too old");
    });
});
