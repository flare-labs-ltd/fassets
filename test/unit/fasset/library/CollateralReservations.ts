import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { ethers } from "hardhat";
import { AgentVaultInstance, AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { CollateralReserved } from "../../../../typechain-truffle/AssetManager";
import { EventArgs, findRequiredEvent, requiredEventArgs } from "../../../utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { TX_BLOCKED, TX_FAILED } from "../../../utils/fasset/ChainInterfaces";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { BNish, getTestFile, toBN, toBNExp, toWei } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../utils/verification/sources/sources";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createTestSettings } from "../test-settings";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientMock');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

contract(`CollateralReservations.sol; ${getTestFile(__filename)}; CollateralReservations basic tests`, async accounts => {
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
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;

    const feeBIPS = 500;
    
    // addresses
    const agentOwner1 = accounts[20];
    const minterAddress1 = accounts[30];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1"; 
    const underlyingMinter1 = "Minter1";
    const underlyingRandomAddress = "Random";

    async function createAgent(chain: MockChain, owner: string, underlyingAddress: string) {
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
        await assetManager.makeAgentAvailable(agentVault.address, feeBIPS, 2_2000, { from: owner });
    }

    async function reserveCollateral(agentVault: string, lots: BNish) {
        const agentInfo = await assetManager.getAgentInfo(agentVault);
        const crFee = await assetManager.collateralReservationFee(lots);
        const res = await assetManager.reserveCollateral(agentVault, lots, agentInfo.feeBIPS, { from: minterAddress1, value: crFee });
        return requiredEventArgs(res, 'CollateralReserved');
    }
    
    async function performMintingPayment(crt: EventArgs<CollateralReserved>) {
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        chain.mint(underlyingMinter1, paymentAmount);
        return await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
    }

    async function performSelfMintingPayment(agentVault: string, paymentAmount: BNish) {
        chain.mint(underlyingRandomAddress, paymentAmount);
        return await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVault));
    }

    beforeEach(async () => {
        // create atetstation client
        attestationClient = await AttestationClient.new();
        // create mock chain attestation provider
        chain = new MockChain(await time.latest());
        wallet = new MockChainWallet(chain);
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

    it("should reserve collateral", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 2;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, { from: minterAddress1, value: crFee });
        // assert
        const settings = await assetManager.getSettings();
        const lotSize = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
        const args = requiredEventArgs(tx, "CollateralReserved");
        assertWeb3Equal(args.agentVault, agentVault.address);
        assertWeb3Equal(args.collateralReservationId, 1);
        assertWeb3Equal(args.minter, minterAddress1);
        assertWeb3Equal(args.paymentAddress, underlyingAgent1);
        assertWeb3Equal(args.paymentReference, PaymentReference.minting(1));
        assertWeb3Equal(args.valueUBA, lotSize.muln(lots));
        assertWeb3Equal(args.feeUBA, lotSize.muln(lots * feeBIPS).divn(10000));
    });

    it("should not reserve collateral if agent not available", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const promise = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, { from: minterAddress1, value: crFee });
        // assert
        await expectRevert(promise, "agent not in mint queue");
    });

    it("should not reserve collateral if trying to mint 0 lots", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const promise = assetManager.reserveCollateral(agentVault.address, 0, feeBIPS, { from: minterAddress1, value: crFee });
        // assert
        await expectRevert(promise, "cannot mint 0 lots");
    });

    it("should not reserve collateral if agent's status is not 'NORMAL'", async () => {
        // init
        chain.mint(underlyingAgent1, 100);
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const tx = await wallet.addTransaction(underlyingAgent1, underlyingRandomAddress, 100, null);
        const proof = await attestationProvider.proveBalanceDecreasingTransaction(tx, underlyingAgent1);
        await assetManager.illegalPaymentChallenge(proof, agentVault.address);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const promise = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, { from: minterAddress1, value: crFee });
        // assert
        await expectRevert(promise, "rc: invalid agent status");
    });

    it("should not reserve collateral if not enough free collateral", async () => {
        // init
        chain.mint(underlyingAgent1, 100);
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 10000;
        const crFee = await assetManager.collateralReservationFee(lots);
        const promise = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, { from: minterAddress1, value: crFee });
        // assert
        await expectRevert(promise, "not enough free collateral");
    });

    it("should not reserve collateral if agent's fee is too high", async () => {
        // init
        chain.mint(underlyingAgent1, 100);
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const promise = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS - 1, { from: minterAddress1, value: crFee });
        // assert
        await expectRevert(promise, "agent's fee too high");
    });

    it("should not reserve collateral if inappropriate fee amount is sent", async () => {
        // init
        chain.mint(underlyingAgent1, 100);
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        // assert
        const promise1 = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, { from: minterAddress1, value: crFee.subn(1) });
        await expectRevert(promise1, "inappropriate fee amount");
        const promise2 = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, { from: minterAddress1, value: crFee.addn(1) });
        await expectRevert(promise2, "inappropriate fee amount");
    });

    
    it.skip("should not execute minting default if minting payment too small", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const paymentAmount = crt.valueUBA.add(crt.feeUBA).subn(1);
        chain.mint(underlyingMinter1, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const promise = assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        // assert
        await expectRevert(promise, "minting payment too small");
    });

    it.skip("should not self-mint if self-mint payment too old", async () => {
        // init
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const nonce = await ethers.provider.getTransactionCount(assetManager.address);
        let agentVaultAddressCalc = ethers.utils.getContractAddress({from: assetManager.address, nonce: nonce});
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVaultAddressCalc));
        
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "self-mint payment too old");
    });
});
