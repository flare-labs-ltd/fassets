import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { LiquidationStrategyImplSettings, encodeLiquidationStrategyImplSettings } from "../../../../lib/fasset/LiquidationStrategyImpl";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { erc165InterfaceId, toBNExp } from "../../../../lib/utils/helpers";
import { web3DeepNormalize } from "../../../../lib/utils/web3normalize";
import { AgentOwnerRegistryInstance, AgentVaultInstance, AssetManagerControllerInstance, AssetManagerInstance, ERC20MockInstance, FAssetInstance, WNatInstance, WhitelistInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { newAssetManager, waitForTimelock } from "../../../utils/fasset/CreateAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestFtsos, TestSettingsContracts, createTestAgentSettings, createTestCollaterals, createTestContracts, createTestFtsos, createTestLiquidationSettings, createTestSettings } from "../../../utils/test-settings";
import { findRequiredEvent } from "../../../../lib/utils/events/truffle";

const Whitelist = artifacts.require('Whitelist');
const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");
const AssetManagerController = artifacts.require('AssetManagerController');
const AgentVault = artifacts.require('AgentVault');

contract(`AgentOwnerRegistry.sol; ${getTestFile(__filename)}; Agent owner registry tests`, async accounts => {
    const governance = accounts[10];
    const updateExecutor = accounts[11];
    let assetManagerController: AssetManagerControllerInstance;
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
    let whitelist: WhitelistInstance;
    let agentOwnerRegistry: AgentOwnerRegistryInstance;

    let liquidationStrategySettings: LiquidationStrategyImplSettings;

    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[23];
    const underlyingAgent1 = "Agent1";

    async function createAgentVaultWithEOA(owner: string, underlyingAddress: string): Promise<AgentVaultInstance> {
        chain.mint(underlyingAddress, toBNExp(100, 18));
        const txHash = await wallet.addTransaction(underlyingAddress, underlyingBurnAddr, 1, PaymentReference.addressOwnership(owner));
        const proof = await attestationProvider.provePayment(txHash, underlyingAddress, underlyingBurnAddr);
        await assetManager.proveUnderlyingAddressEOA(proof, { from: owner });
        const addressValidityProof = await attestationProvider.proveAddressValidity(underlyingAddress);
        assert.isTrue(addressValidityProof.data.responseBody.isValid);
        const settings = createTestAgentSettings(usdc.address);
        const response = await assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(settings), { from: owner });
        return AgentVault.at(findRequiredEvent(response, 'AgentVaultCreated').args.agentVault);
    }

    async function initialize() {
        const ci = testChainInfo.eth;
        contracts = await createTestContracts(governance);
        await contracts.governanceSettings.setExecutors([governance, updateExecutor], { from: governance });
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
        // create whitelist
        whitelist = await Whitelist.new(contracts.governanceSettings.address, governance, false);
        await whitelist.switchToProductionMode({ from: governance });
        // create asset manager controller
        assetManagerController = await AssetManagerController.new(contracts.governanceSettings.address, governance, contracts.addressUpdater.address);
        await assetManagerController.switchToProductionMode({ from: governance });
        // crate liquidation strategy settings
        liquidationStrategySettings = createTestLiquidationSettings();
        // create asset manager
        collaterals = createTestCollaterals(contracts, ci);
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        const encodedLiquidationStrategySettings = encodeLiquidationStrategyImplSettings(liquidationStrategySettings);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, encodedLiquidationStrategySettings, updateExecutor);

        agentOwnerRegistry = await AgentOwnerRegistry.new(contracts.governanceSettings.address, governance, true);
        await agentOwnerRegistry.switchToProductionMode({ from: governance });

        const res = await assetManagerController.setAgentOwnerRegistry([assetManager.address], agentOwnerRegistry.address, { from: governance });
        await waitForTimelock(res, assetManagerController, updateExecutor);
        return { contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, whitelist, assetManagerController, liquidationStrategySettings, collaterals, settings, assetManager, fAsset, agentOwnerRegistry };
    }

    beforeEach(async () => {
        ({ contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, whitelist, assetManagerController, liquidationStrategySettings, collaterals, settings, assetManager, fAsset, agentOwnerRegistry } =
            await loadFixtureCopyVars(initialize));
    });

    describe("whitelist functions", () => {
        it("should not set owner work address when not whitelisted", async () => {
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const ownerWorkAddress = accounts[21];
            const res = agentOwnerRegistry.setWorkAddress(ownerWorkAddress, { from: agentOwner1 });
            await expectRevert(res, "agent not whitelisted");
        });

        it("should set owner work address after whitelisting", async () => {
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const ownerWorkAddress = accounts[21];
            await agentOwnerRegistry.addAddressesToWhitelist([agentOwner1], {from: governance});
            await agentOwnerRegistry.setWorkAddress(ownerWorkAddress, { from: agentOwner1 });
            const res = await agentOwnerRegistry.isWhitelisted(agentOwner1);
            assert.equal(res,true);
        });

        it("should not allow setting work address if work address is set on another agent owner", async () => {
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const ownerWorkAddress = accounts[21];
            await agentOwnerRegistry.addAddressesToWhitelist([agentOwner1], {from: governance});
            await agentOwnerRegistry.setWorkAddress(ownerWorkAddress, { from: agentOwner1 });

            await agentOwnerRegistry.addAddressesToWhitelist([agentOwner2], {from: governance});
            const res = agentOwnerRegistry.setWorkAddress(ownerWorkAddress, { from: agentOwner2 });
            await expectRevert(res, "work address in use");
        });

        it("should not create agent from work address after revoking management address", async () => {
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const ownerWorkAddress = accounts[21];
            await agentOwnerRegistry.addAddressesToWhitelist([agentOwner1], {from: governance});
            await agentOwnerRegistry.setWorkAddress(ownerWorkAddress, { from: agentOwner1 });
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
            await assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 });
            const agentSettings = createTestAgentSettings(usdc.address);

            //Revoke address and wait for timelock
            let rev = await agentOwnerRegistry.revokeAddress(agentOwner1, {from: governance});
            await waitForTimelock(rev, agentOwnerRegistry, governance);

            //Try to create agent
            const addressValidityProof = await attestationProvider.proveAddressValidity(underlyingAgent1);
            assert.isTrue(addressValidityProof.data.responseBody.isValid);
            const res = assetManager.createAgentVault(web3DeepNormalize(addressValidityProof), web3DeepNormalize(agentSettings), { from: ownerWorkAddress });
            await expectRevert(res, "agent not whitelisted");
        });

        it("should not allow proving underlying address eoa if address not whitelisted", async () => {
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
            const res = assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 });
            await expectRevert(res, "agent not whitelisted");
        });
    });

    describe("setting work address", () => {
        it("should set owner work address", async () => {
            await agentOwnerRegistry.addAddressToWhitelist(agentOwner1, { from: governance });
            // create agent
            const agentVault = await createAgentVaultWithEOA(agentOwner1, underlyingAgent1);
            // set owner work address
            await agentOwnerRegistry.setWorkAddress("0xe34BDff68a5b89216D7f6021c1AB25c012142425", { from: agentOwner1 });
            const managementAddress = await assetManager.getAgentVaultOwner(agentVault.address);
            const info = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(managementAddress, agentOwner1);
            assert.equal(info.ownerManagementAddress, agentOwner1);
            assert.equal(info.ownerWorkAddress, "0xe34BDff68a5b89216D7f6021c1AB25c012142425");
            // set owner work address again
            await agentOwnerRegistry.setWorkAddress("0x27e80dB1f5a975f4C43C5eC163114E796cdB603D", { from: agentOwner1 });
            const info2 = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(info2.ownerManagementAddress, agentOwner1);
            assert.equal(info2.ownerWorkAddress, "0x27e80dB1f5a975f4C43C5eC163114E796cdB603D");
            // set owner work address again with address 0
            await agentOwnerRegistry.setWorkAddress(constants.ZERO_ADDRESS, { from: agentOwner1 });
            const info3 = await assetManager.getAgentInfo(agentVault.address);
            assert.equal(info3.ownerManagementAddress, agentOwner1);
            assert.equal(info3.ownerWorkAddress, constants.ZERO_ADDRESS);
        });

        it("checking agent vault owner with work address should work", async () => {
            await agentOwnerRegistry.addAddressToWhitelist(agentOwner1, { from: governance });
            // create agent
            const agentVault = await createAgentVaultWithEOA(agentOwner1, underlyingAgent1);
            const workAddress = "0xe34BDff68a5b89216D7f6021c1AB25c012142425";
            // set owner work address
            await agentOwnerRegistry.setWorkAddress(workAddress, { from: agentOwner1 });
            assert.equal(await assetManager.isAgentVaultOwner(agentVault.address, workAddress), true);
        });
    });


    describe("ERC-165 interface identification for Agent Vault", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as 'IERC165');
            const IWhitelist = artifacts.require("IWhitelist");
            const IAgentOwnerRegistry = artifacts.require("IAgentOwnerRegistry");
            const iERC165 = await IERC165.at(agentOwnerRegistry.address);
            const iWhitelist = await IWhitelist.at(agentOwnerRegistry.address);
            const iAgentOwnerRegistry = await IAgentOwnerRegistry.at(agentOwnerRegistry.address);
            assert.isTrue(await agentOwnerRegistry.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await agentOwnerRegistry.supportsInterface(erc165InterfaceId(iWhitelist.abi)));
            assert.isTrue(await agentOwnerRegistry.supportsInterface(erc165InterfaceId(iAgentOwnerRegistry.abi, [iWhitelist.abi])));
            assert.isFalse(await agentOwnerRegistry.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });
});
