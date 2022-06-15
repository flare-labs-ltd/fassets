import { expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentVaultInstance, AssetManagerInstance, AttestationClientSCInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { ChainInfo, testChainInfo } from "../../../integration/utils/ChainInfo";
import { filterEvents, findRequiredEvent, requiredEventArgs } from "../../../../lib/utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { toBN, toBNExp, toWei } from "../../../../lib/utils/helpers";
import { getTestFile } from "../../../utils/test-helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../../lib/verification/sources/sources";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createTestSettings } from "../test-settings";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientSC');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const StateConnector = artifacts.require('StateConnectorMock');
const AgentVaultFactory = artifacts.require('AgentVaultFactory');

contract(`Liquidation.sol; ${getTestFile(__filename)}; Liquidation basic tests`, async accounts => {
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
    let chainInfo: ChainInfo;
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


    async function createAgent(owner: string, underlyingAddress: string) {
        // mint some funds on underlying address (just enough to make EOA proof)
        chain.mint(underlyingAddress, 101);
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
        // create state connector
        const stateConnector = await StateConnector.new();
        // create agent vault factory
        const agentVaultFactory = await AgentVaultFactory.new();
        // create atetstation client
        attestationClient = await AttestationClient.new(stateConnector.address);
        // create mock chain attestation provider
        chain = new MockChain(await time.latest());
        wallet = new MockChainWallet(chain);
        chainInfo = testChainInfo.eth;
        chain.secondsPerBlock = chainInfo.blockTime;
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
        await assetFtso.setCurrentPrice(toBNExp(3521, 50), 0);
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
        await assetFtso.setCurrentPrice(toBNExp(3521, 50), 0);
        await assetManager.startLiquidation(agentVault.address);
        const info1 = await assetManager.getAgentInfo(agentVault.address);
        // liquidator "buys" f-assets
        await fAsset.transfer(liquidatorAddress1, minted.mintedAmountUBA.divn(2), { from: minterAddress1 });
        await assetManager.liquidate(agentVault.address, minted.mintedAmountUBA.divn(2), { from: liquidatorAddress1 });
        await assetFtso.setCurrentPrice(toBNExp(3521, 5), 0);
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
