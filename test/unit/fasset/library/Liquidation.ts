import { expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSettings, AssetManagerSettings, CollateralToken } from "../../../../lib/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { filterEvents, requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { toBN, toBNExp, toWei } from "../../../../lib/utils/helpers";
import { AgentVaultInstance, AssetManagerInstance, ERC20MockInstance, FAssetInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createEncodedTestLiquidationSettings, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings, TestFtsos, TestSettingsContracts } from "../test-settings";

contract(`Liquidation.sol; ${getTestFile(__filename)}; Liquidation basic tests`, async accounts => {
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
    const minterAddress1 = accounts[30];
    const redeemerAddress1 = accounts[40];
    const liquidatorAddress1 = accounts[60];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingMinter1 = "Minter1";
    const underlyingRedeemer1 = "Redeemer1";


    function createAgent(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const class1CollateralToken = options?.class1CollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings, chain, wallet, attestationProvider }, owner, underlyingAddress, class1CollateralToken, options);
    }

    async function depositAndMakeAgentAvailable(agentVault: AgentVaultInstance, owner: string) {
        // depositCollateral
        const fullAgentCollateral = toWei(3e8);
        await agentVault.deposit({ from: owner, value: toBN(fullAgentCollateral) });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 2_2000, { from: owner });
    }

    async function mint(agentVault: AgentVaultInstance, underlyingMinterAddress: string, minterAddress: string) {
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
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async function redeem(underlyingRedeemerAddress: string, redeemerAddress: string) {
        const lots = 3;
        const resR = await assetManager.redeem(lots, underlyingRedeemerAddress, { from: redeemerAddress });
        const redemptionRequests = filterEvents(resR, 'RedemptionRequested').map(e => e.args);
        const request = redemptionRequests[0];
        return request;
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

    it("should not liquidate if collateral ratio is ok", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        await mint(agentVault, underlyingMinter1, minterAddress1);
        // act
        const promise = assetManager.liquidate(agentVault.address, 500);
        // assert
        await expectRevert(promise, "not in liquidation");
    });

    it("should not start full liquidation if agent is in status DESTROYING", async () => {
        // init
        chain.mint(underlyingAgent1, 100);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        const tx = await wallet.addTransaction(underlyingAgent1, underlyingRedeemer1, 100, null);
        const proof = await attestationProvider.proveBalanceDecreasingTransaction(tx, underlyingAgent1);
        await assetManager.illegalPaymentChallenge(proof, agentVault.address);
        // assert
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.status, 4);
    });

    it("should not change liquidationStartedAt timestamp when liquidation phase does not change (liquidation -> full_liquidation)", async () => {
        // init
        chain.mint(underlyingAgent1, 100);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        await mint(agentVault, underlyingMinter1, minterAddress1);
        // act
        await ftsos.asset.setCurrentPrice(toBNExp(3521, 50), 0);
        await assetManager.startLiquidation(agentVault.address);
        const info1 = await assetManager.getAgentInfo(agentVault.address);
        const tx = await wallet.addTransaction(underlyingAgent1, underlyingRedeemer1, 100, null);
        const proof = await attestationProvider.proveBalanceDecreasingTransaction(tx, underlyingAgent1);
        await assetManager.illegalPaymentChallenge(proof, agentVault.address);
        const info2 = await assetManager.getAgentInfo(agentVault.address);
        // assert
        assertWeb3Equal(info1.liquidationStartTimestamp, info2.liquidationStartTimestamp);
        assertWeb3Equal(info1.status, 2);
        assertWeb3Equal(info2.status, 3);
    });

    it("should not do anything if callig startLiquidation twice", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const minted = await mint(agentVault, underlyingMinter1, minterAddress1);
        // act
        await ftsos.asset.setCurrentPrice(toBNExp(3521, 50), 0);
        await assetManager.startLiquidation(agentVault.address);
        const info1 = await assetManager.getAgentInfo(agentVault.address);
        // liquidator "buys" f-assets
        await fAsset.transfer(liquidatorAddress1, minted.mintedAmountUBA.divn(2), { from: minterAddress1 });
        await assetManager.liquidate(agentVault.address, minted.mintedAmountUBA.divn(2), { from: liquidatorAddress1 });
        await ftsos.asset.setCurrentPrice(toBNExp(3521, 5), 0);
        await assetManager.startLiquidation(agentVault.address);
        const info2 = await assetManager.getAgentInfo(agentVault.address);
        await assetManager.endLiquidation(agentVault.address);
        const info3 = await assetManager.getAgentInfo(agentVault.address);
        // assert
        assertWeb3Equal(info1.liquidationStartTimestamp, info2.liquidationStartTimestamp);
        assertWeb3Equal(info1.status, 2);
        assertWeb3Equal(info2.status, 2);
        assertWeb3Equal(info3.status, 0);
    });
});
