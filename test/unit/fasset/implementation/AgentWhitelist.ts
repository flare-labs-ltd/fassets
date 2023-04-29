import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralToken } from "../../../../lib/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { LiquidationStrategyImplSettings, encodeLiquidationStrategyImplSettings, decodeLiquidationStrategyImplSettings } from "../../../../lib/fasset/LiquidationStrategyImpl";
import { BN_ZERO, DAYS, HOURS, MAX_BIPS, WEEKS, randomAddress, toBIPS, toBN, toStringExp, toBNExp } from "../../../../lib/utils/helpers";
import { AssetManagerControllerInstance, AssetManagerInstance, ERC20MockInstance, FAssetInstance, WhitelistInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { newAssetManager, waitForTimelock } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3Equal, web3ResultStruct } from "../../../utils/web3assertions";
import { createTestLiquidationSettings, createEncodedTestLiquidationSettings, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings, TestFtsos, TestSettingsContracts, createTestAgentSettings } from "../test-settings";
import { ERC20Mock__factory, SafePctMock__factory } from "../../../../typechain";
import { getAddress } from "ethers/lib/utils";
import { ethers } from "hardhat";
import { web3DeepNormalize } from "../../../../lib/utils/web3normalize";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";

const Whitelist = artifacts.require('Whitelist');
const AssetManagerController = artifacts.require('AssetManagerController');

contract(`Whitelist.sol; ${getTestFile(__filename)}; Agent whitelist tests`, async accounts => {
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
    let collaterals: CollateralToken[];
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;
    let whitelist: WhitelistInstance;
    let agentWhitelist: WhitelistInstance;

    let liquidationStrategySettings: LiquidationStrategyImplSettings;

    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[23];
    const underlyingAgent1 = "Agent1";

    beforeEach(async () => {
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

        agentWhitelist = await Whitelist.new(contracts.governanceSettings.address, governance, true);
        await agentWhitelist.switchToProductionMode({ from: governance });

        const res = await assetManagerController.setAgentWhitelist([assetManager.address], agentWhitelist.address, { from: governance });
        await waitForTimelock(res, assetManagerController, updateExecutor);
    });

    describe("whitelist functions", () => {
        it("should not set owner hot when not whitelisted", async () => {
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const ownerHotAddress = accounts[21];
            const res = assetManager.setOwnerHotAddress(ownerHotAddress, { from: agentOwner1 });
            await expectRevert(res, "agent not whitelisted");
        });

        it("should set owner hot address after whitelisting", async () => {
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const ownerHotAddress = accounts[21];
            await agentWhitelist.addAddressesToWhitelist([agentOwner1], {from: governance});
            await assetManager.setOwnerHotAddress(ownerHotAddress, { from: agentOwner1 });
            const res = await agentWhitelist.isWhitelisted(agentOwner1);
            assert.equal(res,true);
        });

        it("should not allow setting hot address if hot address is set on another agent owner", async () => {
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const ownerHotAddress = accounts[21];
            await agentWhitelist.addAddressesToWhitelist([agentOwner1], {from: governance});
            await assetManager.setOwnerHotAddress(ownerHotAddress, { from: agentOwner1 });

            await agentWhitelist.addAddressesToWhitelist([agentOwner2], {from: governance});
            const res = assetManager.setOwnerHotAddress(ownerHotAddress, { from: agentOwner2 });
            await expectRevert(res, "hot address in use");
        });

        it("should not create agent from hot address after revoking cold address", async () => {
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const ownerHotAddress = accounts[21];
            await agentWhitelist.addAddressesToWhitelist([agentOwner1], {from: governance});
            assetManager.setOwnerHotAddress(ownerHotAddress, { from: agentOwner1 });
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
            await assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 });
            const agentSettings = createTestAgentSettings(underlyingAgent1, usdc.address);

            //Revoke address and wait for timelock
            let rev = await agentWhitelist.revokeAddress(agentOwner1, {from: governance});
            await waitForTimelock(rev, agentWhitelist, governance);

            //Try to create agent
            const res = assetManager.createAgent(web3DeepNormalize(agentSettings), { from: ownerHotAddress });
            await expectRevert(res, "agent not whitelisted");
        });

        it("should not allow proving underlying address eoa if address not whitelisted", async () => {
            chain.mint(underlyingAgent1, toBNExp(100, 18));
            const ownerHotAddress = accounts[21];
            assetManager.setOwnerHotAddress(ownerHotAddress, { from: agentOwner1 });
            const txHash = await wallet.addTransaction(underlyingAgent1, underlyingBurnAddr, 1, PaymentReference.addressOwnership(agentOwner1));
            const proof = await attestationProvider.provePayment(txHash, underlyingAgent1, underlyingBurnAddr);
            const res = assetManager.proveUnderlyingAddressEOA(proof, { from: agentOwner1 });
            await expectRevert(res, "agent not whitelisted");
        });
    });
});