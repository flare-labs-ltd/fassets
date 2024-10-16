import { ARESBase, AddressValidity, Payment } from "@flarenetwork/state-connector-protocol";
import { ether, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSetting, AgentSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { SourceId } from "../../../../lib/underlying-chain/SourceId";
import { requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { BNish, toBN, toBNExp, toWei, ZERO_ADDRESS } from "../../../../lib/utils/helpers";
import { web3DeepNormalize } from "../../../../lib/utils/web3normalize";
import { AgentVaultInstance, ERC20MockInstance, FAssetInstance, IIAssetManagerInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { AssetManagerInitSettings, newAssetManager } from "../../../utils/fasset/CreateAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import {
    TestFtsos, TestSettingsContracts, createTestAgent, createTestAgentSettings, createTestCollaterals, createTestContracts,
    createTestFtsos, createTestSettings
} from "../../../utils/test-settings";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");

contract(`Agent.sol; ${getTestFile(__filename)}; Agent basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let contracts: TestSettingsContracts;
    let assetManager: IIAssetManagerInstance;
    let fAsset: FAssetInstance;
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

    async function depositCollateral(owner: string, agentVault: AgentVaultInstance, amount: BN, token: ERC20MockInstance = usdc) {
        await token.mintAmount(owner, amount);
        await token.approve(agentVault.address, amount, { from: owner });
        await agentVault.depositCollateral(token.address, amount, { from: owner });
    }

    async function changeAgentSetting(owner: string, agentVault: AgentVaultInstance, name: AgentSetting, value: BNish) {
        const res = await assetManager.announceAgentSettingUpdate(agentVault.address, name, value, { from: owner });
        const announcement = requiredEventArgs(res, 'AgentSettingChangeAnnounced');
        await time.increaseTo(announcement.validAt);
        return await assetManager.executeAgentSettingUpdate(agentVault.address, name, { from: owner });
    }

    async function initialize() {
        const ci = testChainInfo.btc;
        contracts = await createTestContracts(governance);
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
        settings = createTestSettings(contracts, ci);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        return { contracts, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset };
    }

    beforeEach(async () => {
        ({ contracts, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset } = await loadFixtureCopyVars(initialize));
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

    it("should prove EOA address without changing current block number", async () => {
        // init
        chain.mint(underlyingAgent1, toBNExp(100, 18));
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
        chain.mine(3);  // skip some blocks
        const proofBlock = await attestationProvider.proveConfirmedBlockHeightExists(Number(settings.attestationWindowSeconds));
        await assetManager.updateCurrentBlock(proofBlock);
        await assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 });
        // assert
        const { 0: currentBlock } = await assetManager.currentUnderlyingBlock();
        assertWeb3Equal(currentBlock, proofBlock.data.requestBody.blockNumber);
        assert.isAbove(Number(currentBlock), Number(proof.data.responseBody.blockNumber) + 2);
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
        const addressValidityProof = await attestationProvider.proveAddressValidity(underlyingAgent1);
        assert.isTrue(addressValidityProof.data.responseBody.isValid);
        const agentSettings = createTestAgentSettings(usdc.address);
        const res = await assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: agentOwner1 });
        // assert
        expectEvent(res, "AgentVaultCreated", { owner: agentOwner1 });
        const args = requiredEventArgs(res, "AgentVaultCreated");
        assert.equal(args.creationData.underlyingAddress, underlyingAgent1);
        assert.notEqual(args.creationData.collateralPool, ZERO_ADDRESS);
        assert.notEqual(args.creationData.collateralPoolToken, ZERO_ADDRESS);
        assert.equal(args.creationData.vaultCollateralToken, usdc.address);
        assert.notEqual(args.creationData.collateralPoolToken, contracts.wNat.address);
        assert.equal(args.creationData.handShakeType, toBN(0));
    });

    it("should create agent from owner's work address", async () => {
        // init
        chain.mint(underlyingAgent1, toBNExp(100, 18));
        const ownerWorkAddress = accounts[21];
        await contracts.agentOwnerRegistry.setWorkAddress(ownerWorkAddress, { from: agentOwner1 });
        // act
        const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
        const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
        await assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 });
        const addressValidityProof = await attestationProvider.proveAddressValidity(underlyingAgent1);
        assert.isTrue(addressValidityProof.data.responseBody.isValid);
        const agentSettings = createTestAgentSettings(usdc.address);
        const res = await assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: ownerWorkAddress });
        // assert
        // the owner returned in the AgentVaultCreated event must be management address
        expectEvent(res, "AgentVaultCreated", { owner: agentOwner1 });
    });

    it("should detect if pool token suffix is reserved", async () => {
        const suffix = "SUFFX1";
        assert.isFalse(await assetManager.isPoolTokenSuffixReserved(suffix));
        await createAgent(agentOwner1, underlyingAgent1, { poolTokenSuffix: suffix });
        assert.isTrue(await assetManager.isPoolTokenSuffixReserved(suffix));
    });

    it("should require underlying address to not be empty", async () => {
        // init
        // act
        // assert
        const addressValidityProof = await attestationProvider.proveAddressValidity("");
        assert.isFalse(addressValidityProof.data.responseBody.isValid);
        assert.isFalse(addressValidityProof.data.responseBody.isValid);
        const agentSettings = createTestAgentSettings(usdc.address);
        await expectRevert(assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: agentOwner1 }),
            "address invalid");
    });

    it("should not create agent - address already claimed (with EOA proof)", async () => {
        // init
        const ci = testChainInfo.btc;
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        // act
        await createAgent(agentOwner1, underlyingAgent1);
        // assert
        const addressValidityProof = await attestationProvider.proveAddressValidity(underlyingAgent1);
        assert.isTrue(addressValidityProof.data.responseBody.isValid);
        const agentSettings = createTestAgentSettings(usdc.address);
        await expectRevert(assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings)),
            "address already claimed");
    });

    it("should not create agent - address already claimed (no EOA proof)", async () => {
        // init
        // act
        await createAgent(agentOwner1, underlyingAgent1);
        // assert
        await expectRevert(createAgent(accounts[1], underlyingAgent1),
            "address already claimed");
    });

    it("should not create agent - underlying address used twice", async () => {
        // init
        // act
        await createAgent(agentOwner1, underlyingAgent1);
        // assert
        await expectRevert(createAgent(agentOwner1, underlyingAgent1),
            "address already claimed");
    });

    it("should create expected pool token name and symbol", async () => {
        // init
        const agent = await createAgent(agentOwner1, underlyingAgent1, { poolTokenSuffix: "AGX" });
        // act
        // assert
        const pool = await CollateralPool.at(await agent.collateralPool());
        const poolToken = await CollateralPoolToken.at(await pool.poolToken());
        assert.equal(await poolToken.name(), "FAsset Collateral Pool Token BTC-AGX");
        assert.equal(await poolToken.symbol(), "FCPT-BTC-AGX");
    });

    it("should not create agent if pool token is not unique or invalid", async () => {
        // init
        const agent = await createAgent(agentOwner1, underlyingAgent1, { poolTokenSuffix: "AG-X-5" });
        // act
        // assert
        await expectRevert(createAgent(agentOwner1, underlyingAgent1 + "_1", { poolTokenSuffix: "AG-X-5" }),
            "suffix already reserved");
        await expectRevert(createAgent(agentOwner1, underlyingAgent1 + "_2", { poolTokenSuffix: "AGX12345678901234567890" }),
            "suffix too long");
        await expectRevert(createAgent(agentOwner1, underlyingAgent1 + "_3", { poolTokenSuffix: "A B" }),
            "invalid character in suffix");
        await expectRevert(createAgent(agentOwner1, underlyingAgent1 + "_5", { poolTokenSuffix: "ABČ" }),
            "invalid character in suffix");
        await expectRevert(createAgent(agentOwner1, underlyingAgent1 + "_6", { poolTokenSuffix: "ABc" }),
            "invalid character in suffix");
        await expectRevert(createAgent(agentOwner1, underlyingAgent1 + "_7", { poolTokenSuffix: "A+B" }),
            "invalid character in suffix");
        await expectRevert(createAgent(agentOwner1, underlyingAgent1 + "_7a", { poolTokenSuffix: "A=B" }),
            "invalid character in suffix");
        await expectRevert(createAgent(agentOwner1, underlyingAgent1 + "_7b", { poolTokenSuffix: "A_B" }),
            "invalid character in suffix");
        await expectRevert(createAgent(agentOwner1, underlyingAgent1 + "_8", { poolTokenSuffix: "-AB" }),
            "invalid character in suffix");
        await expectRevert(createAgent(agentOwner1, underlyingAgent1 + "_9", { poolTokenSuffix: "AB-" }),
            "invalid character in suffix");
    });

    it("should require EOA check to create agent", async () => {
        // init
        const ci = testChainInfo.btc;
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        // act
        // assert
        const addressValidityProof = await attestationProvider.proveAddressValidity(underlyingAgent1);
        assert.isTrue(addressValidityProof.data.responseBody.isValid);
        const agentSettings = createTestAgentSettings(usdc.address);
        await expectRevert(assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: agentOwner1 }),
            "EOA proof required");
    });

    it("should require proof that address is valid", async () => {
        // init
        const ci = testChainInfo.btc;
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        // act
        // assert
        const addressValidityProof = await attestationProvider.proveAddressValidity("INVALID_ADDRESS");
        const agentSettings = createTestAgentSettings(usdc.address);
        await expectRevert(assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: agentOwner1 }),
            "address invalid");
    });

    function createAddressValidityProof(): AddressValidity.Proof {
        return {
            data: {
                "attestationType": "0x4164647265737356616c69646974790000000000000000000000000000000000",
                "sourceId": SourceId.BTC,
                "votingRound": "0",
                "lowestUsedTimestamp": "0",
                "requestBody": {
                    "addressStr": "MY_VALID_ADDRESS"
                },
                "responseBody": {
                    "isValid": true,
                    "standardAddress": "MY_VALID_ADDRESS",
                    "standardAddressHash": "0x5835bde41ad7151fa621c0d2c59b721c7be4d7df81451a418a8e76f868050272"
                }
            },
            merkleProof: []
        };
    }

    async function forceProveResponse(attestationType: string, response: ARESBase) {
        const definition = stateConnectorClient.definitionStore.getDefinitionForDecodedAttestationType(attestationType);
        const hash = web3.utils.keccak256(web3.eth.abi.encodeParameters([definition!.responseAbi], [response]));
        await stateConnectorClient.stateConnector.setMerkleRoot(response.votingRound, hash);
    }

    it("should require verified proof", async () => {
        // init
        const ci = testChainInfo.btc;
        settings = createTestSettings(contracts, ci);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        // assert
        const addressValidityProof: AddressValidity.Proof = createAddressValidityProof();
        const agentSettings = createTestAgentSettings(usdc.address);
        await expectRevert(assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: agentOwner1 }),
            "address validity not proved");
    });

    it("should require verified proof - wrong attestation type", async () => {
        // init
        const ci = testChainInfo.btc;
        settings = createTestSettings(contracts, ci);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        // assert
        const addressValidityProof: AddressValidity.Proof = createAddressValidityProof();
        const agentSettings = createTestAgentSettings(usdc.address);
        // should not work with wrong attestation type
        addressValidityProof.data.attestationType = Payment.TYPE;
        await forceProveResponse("AddressValidity", addressValidityProof.data);
        await expectRevert(assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: agentOwner1 }),
            "address validity not proved");
        // should work with correct attestation type
        addressValidityProof.data.attestationType = AddressValidity.TYPE;
        await forceProveResponse("AddressValidity", addressValidityProof.data);
        await assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: agentOwner1 });
    });

    it("only owner can make agent available", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.makeAgentAvailable(agentVault.address),
            "only agent vault owner");
    });

    it("cannot add agent to available list if agent's status is not 'NORMAL'", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        // act
        // assert
        await expectRevert(assetManager.makeAgentAvailable(agentVault.address, { from: agentOwner1 }),
            "invalid agent status");
    });

    it("cannot add agent to available list twice", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await depositCollateral(agentOwner1, agentVault, amount);
        await agentVault.buyCollateralPoolTokens({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, { from: agentOwner1 });
        // act
        // assert
        await expectRevert(assetManager.makeAgentAvailable(agentVault.address, { from: agentOwner1 }),
            "agent already available");
    });

    it("cannot add agent to available list if not enough free collateral", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.makeAgentAvailable(agentVault.address, { from: agentOwner1 }),
            "not enough free collateral");
    });

    it("cannot exit if not active", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await depositCollateral(agentOwner1, agentVault, amount);
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
        await depositCollateral(agentOwner1, agentVault, amount);
        await agentVault.buyCollateralPoolTokens({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, { from: agentOwner1 });
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
        await expectRevert(assetManager.destroyAgent(agentVault.address, agentOwner1),
            "only agent vault owner");
    });

    it("cannot destroy agent without announcement", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.destroyAgent(agentVault.address, agentOwner1, { from: agentOwner1 }),
            "destroy not announced");
    });

    it("cannot destroy agent too soon", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        // act
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        await time.increase(150);
        // assert
        await expectRevert(assetManager.destroyAgent(agentVault.address, agentOwner1, { from: agentOwner1 }), "destroy: not allowed yet");
    });

    it("should destroy agent after announced withdrawal time passes", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        // act
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        // should update status
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.status, 4);
        await time.increase(150);
        // should not change destroy time
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        await time.increase(150);
        const startBalance = await usdc.balanceOf(agentOwner1);
        const tx = await assetManager.destroyAgent(agentVault.address, agentOwner1, { from: agentOwner1 });
        // assert
        const recovered = (await usdc.balanceOf(agentOwner1)).sub(startBalance);
        // console.log(`recovered = ${recovered},  rec=${recipient}`);
        assert.isTrue(recovered.gte(amount), `value recovered from agent vault is ${recovered}, which is less than deposited ${amount}`);
    });

    it("only owner can announce collateral withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.announceVaultCollateralWithdrawal(agentVault.address, 100),
            "only agent vault owner");
    });

    it("should announce collateral withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        // act
        await assetManager.announceVaultCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // assert
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(toBN(info.totalVaultCollateralWei).sub(toBN(info.freeVaultCollateralWei)), 100);
    });

    it("should decrease announced collateral withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        await assetManager.announceVaultCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await assetManager.announceVaultCollateralWithdrawal(agentVault.address, 50, { from: agentOwner1 });
        // assert
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(toBN(info.totalVaultCollateralWei).sub(toBN(info.freeVaultCollateralWei)), 50);
    });

    it("should cancel announced collateral withdrawal", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        await assetManager.announceVaultCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await assetManager.announceVaultCollateralWithdrawal(agentVault.address, 0, { from: agentOwner1 });
        // assert
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.totalVaultCollateralWei, info.freeVaultCollateralWei);
    });

    it("should withdraw collateral after announced withdrawal time passes", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        await assetManager.announceVaultCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await time.increase(300);
        const startBalance = await usdc.balanceOf(agentOwner1);
        const tx = await agentVault.withdrawCollateral(usdc.address, 100, agentOwner1, { from: agentOwner1 });
        // assert
        const withdrawn = (await usdc.balanceOf(agentOwner1)).sub(startBalance);
        assertWeb3Equal(withdrawn, 100);
    });

    it("should withdraw collateral in a few transactions after announced withdrawal time passes, but not more than announced", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        await assetManager.announceVaultCollateralWithdrawal(agentVault.address, 101, { from: agentOwner1 });
        // act
        await time.increase(300);
        const startBalance = await usdc.balanceOf(agentOwner1);
        const tx1 = await agentVault.withdrawCollateral(usdc.address, 45, agentOwner1, { from: agentOwner1 });
        const withdrawn1 = (await usdc.balanceOf(agentOwner1)).sub(startBalance);
        const tx2 = await agentVault.withdrawCollateral(usdc.address, 55, agentOwner1, { from: agentOwner1 });
        const withdrawn2 = (await usdc.balanceOf(agentOwner1)).sub(startBalance);
        // assert
        assertWeb3Equal(withdrawn1, 45);
        assertWeb3Equal(withdrawn2, 100);
        await expectRevert(agentVault.withdrawCollateral(usdc.address, 2, agentOwner1, { from: agentOwner1 }),
            "withdrawal: more than announced");
    });

    it("only owner can withdraw collateral", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        // act
        // assert
        await expectRevert(agentVault.withdrawCollateral(usdc.address, 100, accounts[2]),
            "only owner");
    });

    it("should not withdraw collateral if not accounced", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        // act
        // assert
        await expectRevert(agentVault.withdrawCollateral(usdc.address, 100, agentOwner1, { from: agentOwner1 }),
            "withdrawal: not announced");
    });

    it("should not withdraw collateral before announced withdrawal time passes", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        await assetManager.announceVaultCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await time.increase(150);
        // assert
        await expectRevert(agentVault.withdrawCollateral(usdc.address, 100, agentOwner1, { from: agentOwner1 }),
            "withdrawal: not allowed yet");
    });

    it("should not withdraw collateral after too much time passes", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        await assetManager.announceVaultCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await time.increase(toBN(settings.withdrawalWaitMinSeconds).add(toBN(settings.agentTimelockedOperationWindowSeconds)).addn(100));
        // assert
        await expectRevert(agentVault.withdrawCollateral(usdc.address, 100, agentOwner1, { from: agentOwner1 }),
            "withdrawal: too late");
    });

    it("should not withdraw more collateral than announced", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await depositCollateral(agentOwner1, agentVault, amount);
        await assetManager.announceVaultCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        await time.increase(300);
        // assert
        await expectRevert(agentVault.withdrawCollateral(usdc.address, 101, agentOwner1, { from: agentOwner1 }),
            "withdrawal: more than announced");
    });

    it("should change agent's min collateral ratio", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        const collateralRatioBIPS = 23000;
        await changeAgentSetting(agentOwner1, agentVault, 'mintingVaultCollateralRatioBIPS', collateralRatioBIPS);
        // assert
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.mintingVaultCollateralRatioBIPS, collateralRatioBIPS);
    });

    it("only owner can change agent's min collateral ratio", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        const collateralRatioBIPS = 23000;
        // assert
        await expectRevert(assetManager.announceAgentSettingUpdate(agentVault.address, 'mintingVaultCollateralRatioBIPS', collateralRatioBIPS),
            "only agent vault owner");
        await expectRevert(assetManager.executeAgentSettingUpdate(agentVault.address, 'mintingVaultCollateralRatioBIPS'),
            "only agent vault owner");
    });

    it("should not set too low agent's min collateral ratio", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        const collateralRatioBIPS = 1_4000 - 1;
        // assert
        await expectRevert(changeAgentSetting(agentOwner1, agentVault, 'mintingVaultCollateralRatioBIPS', collateralRatioBIPS),
            "collateral ratio too small");
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.mintingVaultCollateralRatioBIPS, 1_6000);
    });

    it("anyone can call convertDustToTicket", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        // assert
        await assetManager.convertDustToTicket(agentVault.address);
    });

    it("bot should respond to agent ping", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        const ping = await assetManager.agentPing(agentVault.address, 1, { from: accounts[18] });
        expectEvent(ping, "AgentPing", { sender: accounts[18], agentVault: agentVault.address, query: "1" });
        // assert
        // only owner can respond
        await expectRevert(assetManager.agentPingResponse(agentVault.address, 1, "some data", { from: accounts[0] }), "only agent vault owner");
        // response must emit event with owner's address
        const response = await assetManager.agentPingResponse(agentVault.address, 1, "some data", { from: agentOwner1 });
        expectEvent(response, "AgentPingResponse", { agentVault: agentVault.address, owner: agentOwner1, query: "1", response: "some data" });
    });

    // it("create agent underlying XRP address validation tests", async () => {
    //     const ci = testChainInfo.xrp;
    //     const rippleAddressValidator = await RippleAddressValidator.new();
    //     settings.underlyingAddressValidator = rippleAddressValidator.address;
    //     [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals);
    //     const agentXRPAddressCorrect = "rfsK8pNsNeGA8nYWM3PzoRxMRHeAyEtNjN";
    //     const agentXRPAddressTooShort = "rfsK8pNsNeGA8nYWM3PzoRx";
    //     const agentXRPAddressTooLong = "rfsK8pNsNeGA8nYWM3PzoRxMRHeAyEtNjNMRHNFsg";
    //     //Incorrect address with out of vocabulary letter
    //     const agentXRPAddressIncorrect = "rfsK8pNsNeGA8nYWM3PzoRxMRHeAyEtNjž";
    //     //Create agent, underlying address too short
    //     let res = createAgent(agentOwner1, agentXRPAddressTooShort);
    //     await expectRevert(res, "invalid underlying address");
    //     //Create agent, underlying address too short
    //     res = createAgent(agentOwner1, agentXRPAddressTooLong);
    //     await expectRevert(res, "invalid underlying address");
    //     //Create agent, underlying address too short
    //     res = createAgent(agentOwner1, agentXRPAddressIncorrect);
    //     await expectRevert(res, "invalid underlying address");
    //     //Create agent
    //     await createAgent(agentOwner1, agentXRPAddressCorrect);
    // });
});
