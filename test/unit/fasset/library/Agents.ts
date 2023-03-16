import { balance, ether, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSettings, AssetManagerSettings, CollateralToken } from "../../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { toBN, toBNExp, toWei } from "../../../../lib/utils/helpers";
import { web3DeepNormalize } from "../../../../lib/utils/web3normalize";
import { AssetManagerInstance, AttestationClientSCInstance, ERC20MockInstance, FAssetInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { calcGasCost } from "../../../utils/eth";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createEncodedTestLiquidationSettings, createTestAgent, createTestAgentSettings, createTestCollaterals, createTestContracts, createTestFtsos,
    createTestSettings, TestFtsos, TestSettingsContracts } from "../test-settings";

contract(`Agent.sol; ${getTestFile(__filename)}; Agent basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let contracts: TestSettingsContracts;
    let attestationClient: AttestationClientSCInstance;
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
    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique

    function createAgent(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const class1CollateralToken = options?.class1CollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings, chain, wallet, attestationProvider }, owner, underlyingAddress, class1CollateralToken, options);
    }

    beforeEach(async () => {
        const ci = testChainInfo.btc;
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

    it("should prove EOA address", async () => {
        // init
        chain.mint(underlyingAgent1, toBNExp(100, 18));
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
        // assert
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
        await assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 });
    });

    it("should not prove EOA address if wrong payment reference", async () => {
        // init
        chain.mint(underlyingAgent1, toBNExp(100, 18));
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, null);
        // assert
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
        await expectRevert(assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 }), "invalid address ownership proof");
    });

    it("should not prove EOA address - address already claimed", async () => {
        // init
        await createAgent(agentOwner1, underlyingAgent1);
        chain.mint(underlyingAgent1, toBNExp(100, 18));
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
        // assert
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
        await expectRevert(assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 }), "address already claimed");
    });

    it("should create agent", async () => {
        // init
        chain.mint(underlyingAgent1, toBNExp(100, 18));
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
        await assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 });
        const agentSettings = createTestAgentSettings(underlyingAgent1, usdc.address);
        const res = await assetManager.createAgent(web3DeepNormalize(agentSettings), { from: agentOwner1 });
        // assert
        expectEvent(res, "AgentCreated", { owner: agentOwner1, agentType: toBN(1), underlyingAddress: underlyingAgent1 });
    });

    it("should require underlying address to not be empty", async () => {
        // init
        // act
        // assert
        const agentSettings = createTestAgentSettings("", usdc.address);
        await expectRevert(assetManager.createAgent(web3DeepNormalize(agentSettings), { from: agentOwner1 }),
            "empty underlying address");
    });

    it("should not create agent - address already claimed", async () => {
        // init
        await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        const agentSettings = createTestAgentSettings(underlyingAgent1, usdc.address);
        await expectRevert(assetManager.createAgent(web3DeepNormalize(agentSettings)),
            "address already claimed");
    });

    it("should require EOA check to create agent", async () => {
        // init
        // act
        // assert
        const agentSettings = createTestAgentSettings(underlyingAgent1, usdc.address);
        await expectRevert(assetManager.createAgent(web3DeepNormalize(agentSettings), { from: agentOwner1 }),
            "EOA proof required");
    });

    it("only owner can make agent available", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.makeAgentAvailable(agentVault.address, 500, 22000),
            "only agent vault owner");
    });

    it("cannot add agent to available list if agent's status is not 'NORMAL'", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        // act
        // assert
        await expectRevert(assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 }),
            "invalid agent status");
    });

    it("cannot add agent to available list twice", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        // assert
        await expectRevert(assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 }),
            "agent already available");
    });

    it("cannot add agent to available list if not enough free collateral", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 }),
            "not enough free collateral");
    });

    it("cannot exit if not active", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        // assert
        await expectRevert(assetManager.exitAvailableAgentList(agentVault.address, { from: agentOwner1 }),
            "agent not available");
    });

    it("only owner can exit agent", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.exitAvailableAgentList(agentVault.address),
            "only agent vault owner");
    });

    it("only owner can announce destroy agent", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.announceDestroyAgent(agentVault.address),
            "only agent vault owner");
    });

    it("cannot announce destroy agent if still active", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        // assert
        await expectRevert(assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 }),
            "agent still available");
    });

    it("only owner can destroy agent", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.destroyAgent(agentVault.address),
            "only agent vault owner");
    });

    it("cannot destroy agent without announcement", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.destroyAgent(agentVault.address, { from: agentOwner1 }),
            "destroy not announced");
    });

    it("cannot destroy agent too soon", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        await time.increase(150);
        // assert
        await expectRevert(assetManager.destroyAgent(agentVault.address, { from: agentOwner1 }), "destroy: not allowed yet");
    });

    it("should destroy agent after announced withdrawal time passes", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        // should update status
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.status, 4);
        await time.increase(150);
        // should not change destroy time
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        await time.increase(150);
        await expectRevert(agentVault.withdraw(100, { from: agentOwner1 }), "withdrawal: invalid status");
        const startBalance = await balance.current(agentOwner1);
        const tx = await assetManager.destroyAgent(agentVault.address, { from: agentOwner1 });
        // assert
        const recovered = (await balance.current(agentOwner1)).sub(startBalance).add(await calcGasCost(tx));
        // console.log(`recovered = ${recovered},  rec=${recipient}`);
        assert.isTrue(recovered.gte(amount), `value recovered from agent vault is ${recovered}, which is less than deposited ${amount}`);
    });

    it("only owner can announce collateral withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.announceCollateralWithdrawal(agentVault.address, 100),
            "only agent vault owner");
    });

    it("cannot annouce collateral withdrawal if agent's status is not 'NORMAL'", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        // act
        // assert
        await expectRevert(assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 }),
            "withdrawal ann: invalid status");
    });

    it("should announce collateral withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // assert
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(toBN(info.totalCollateralNATWei).sub(toBN(info.freeCollateralNATWei)), 100);
    });

    it("should decrease announced collateral withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await assetManager.announceCollateralWithdrawal(agentVault.address, 50, { from: agentOwner1 });
        // assert
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(toBN(info.totalCollateralNATWei).sub(toBN(info.freeCollateralNATWei)), 50);
    });

    it("should cancel announced collateral withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await assetManager.announceCollateralWithdrawal(agentVault.address, 0, { from: agentOwner1 });
        // assert
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.totalCollateralNATWei, info.freeCollateralNATWei);
    });

    it("should withdraw collateral after announced withdrawal time passes", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await time.increase(300);
        const startBalance = await balance.current(agentOwner1);
        const tx = await agentVault.withdraw(100, { from: agentOwner1 });
        // assert
        const withdrawn = (await balance.current(agentOwner1)).sub(startBalance).add(await calcGasCost(tx));
        assertWeb3Equal(withdrawn, 100);
    });

    it("should withdraw collateral in a few transactions after announced withdrawal time passes, but not more than announced", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await time.increase(300);
        const startBalance = await balance.current(agentOwner1);
        const tx1 = await agentVault.withdraw(45, { from: agentOwner1 });
        const withdrawn1 = (await balance.current(agentOwner1)).sub(startBalance).add(await calcGasCost(tx1));
        const tx2 = await agentVault.withdraw(55, { from: agentOwner1 });
        const withdrawn2 = (await balance.current(agentOwner1)).sub(startBalance).add(await calcGasCost(tx1)).add(await calcGasCost(tx2));
        // assert
        assertWeb3Equal(withdrawn1, 45);
        assertWeb3Equal(withdrawn2, 100);
        await expectRevert(agentVault.withdraw(1, { from: agentOwner1 }),
            "withdrawal: more than announced");
    });

    it("only owner can withdraw collateral", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        // assert
        await expectRevert(agentVault.withdraw(100),
            "only owner");
    });

    it("should not withdraw collateral if not accounced", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        // assert
        await expectRevert(agentVault.withdraw(100, { from: agentOwner1 }),
            "withdrawal: not announced");
    });

    it("should not withdraw collateral before announced withdrawal time passes", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await time.increase(150);
        // assert
        await expectRevert(agentVault.withdraw(100, { from: agentOwner1 }),
            "withdrawal: not allowed yet");
    });

    it("should not withdraw more collateral than announced", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await time.increase(300);
        // assert
        await expectRevert(agentVault.withdraw(101, { from: agentOwner1 }),
            "withdrawal: more than announced");
    });

    it("should change agent's min collateral ratio", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        const collateralRatioBIPS = 23000;
        await assetManager.setAgentMinCollateralRatioBIPS(agentVault.address, collateralRatioBIPS, { from: agentOwner1 });
        // assert
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.agentMinCollateralRatioBIPS, collateralRatioBIPS);
    });

    it("only owner can change agent's min collateral ratio", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        const collateralRatioBIPS = 23000;
        // assert
        await expectRevert(assetManager.setAgentMinCollateralRatioBIPS(agentVault.address, collateralRatioBIPS),
            "only agent vault owner");
    });

    it("should not set too low agent's min collateral ratio", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        const collateralRatioBIPS = 2_1000 - 1;
        // assert
        await expectRevert(assetManager.setAgentMinCollateralRatioBIPS(agentVault.address, collateralRatioBIPS, { from: agentOwner1 }), "collateral ratio too small");
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.agentMinCollateralRatioBIPS, 2_1000);
    });

    it("anyone can call convertDustToTicket", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await assetManager.convertDustToTicket(agentVault.address);
    });
});
