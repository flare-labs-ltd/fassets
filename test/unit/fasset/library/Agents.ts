import { balance, ether, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerInstance, AttestationClientSCInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { findRequiredEvent } from "../../../utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../../utils/fasset/AttestationHelper";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { PaymentReference } from "../../../utils/fasset/PaymentReference";
import { getTestFile, randomAddress, toBN, toBNExp, toWei } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { SourceId } from "../../../utils/verification/sources/sources";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createTestSettings } from "../test-settings";

const AgentVault = artifacts.require('AgentVault');
const AttestationClient = artifacts.require('AttestationClientSC');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const StateConnector = artifacts.require('StateConnectorMock');

contract(`Agent.sol; ${getTestFile(__filename)}; Agent basic tests`, async accounts => {
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
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;
    
    // addresses
    const underlyingBurnAddr = "Burn";
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique


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

    beforeEach(async () => {
        // create state connector
        const stateConnector = await StateConnector.new();
        // create atetstation client
        attestationClient = await AttestationClient.new(stateConnector.address);
        // create mock chain attestation provider
        chain = new MockChain(await time.latest());
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
        settings = createTestSettings(attestationClient, wnat, ftsoRegistry);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings);
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
        await createAgent(chain, agentOwner1, underlyingAgent1);
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
        const res = await assetManager.createAgent(underlyingAgent1, { from: agentOwner1 });
        // assert
        expectEvent(res, "AgentCreated", { owner: agentOwner1, agentType: toBN(1), underlyingAddress: underlyingAgent1 });
    });

    it("should require underlying address to not be empty", async () => {
        // init
        // act
        // assert
        await expectRevert(assetManager.createAgent("", { from: agentOwner1 }),
            "empty underlying address");
    });

    it("should not create agent - address already claimed", async () => {
        // init
        await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.createAgent(underlyingAgent1),
            "address already claimed");
    });

    it("should require EOA check to create agent", async () => {
        // init
        // act
        // assert
        await expectRevert(assetManager.createAgent(underlyingAgent1, { from: agentOwner1 }),
            "EOA proof required");
    });

    it("only owner can make agent available", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.makeAgentAvailable(agentVault.address, 500, 22000),
            "only agent vault owner");
    });

    it("cannot add agent to available list if agent's status is not 'NORMAL'", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 }),
            "not enough free collateral");
    });

    it("cannot exit if not active", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        // assert
        await expectRevert(assetManager.exitAvailableAgentList(agentVault.address, { from: agentOwner1 }),
            "agent not available");
    });

    it("only owner can exit agent", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.exitAvailableAgentList(agentVault.address),
            "only agent vault owner");
    });
    
    it("only owner can announce destroy agent", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.announceDestroyAgent(agentVault.address),
            "only agent vault owner");
    });

    it("cannot announce destroy agent if still active", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.destroyAgent(agentVault.address, agentOwner1),
            "only agent vault owner");
    });

    it("cannot destroy agent without announcement", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.destroyAgent(agentVault.address, agentOwner1, { from: agentOwner1 }),
            "destroy not announced");
    });

    it("cannot destroy agent too soon", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        await time.increase(150);
        const recipient = randomAddress();
        // assert
        await expectRevert(assetManager.destroyAgent(agentVault.address, recipient, { from: agentOwner1 }), "destroy: not allowed yet");
    });

    it("should destroy agent after announced withdrawal time passes", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        // should update status
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.status, 4);
        await time.increase(150);
        const recipient = randomAddress();
        // should not change destroy time
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        await time.increase(150);
        const startBalance = await balance.current(recipient);
        await expectRevert(agentVault.withdraw(agentOwner1, 100, { from: agentOwner1 }), "withdrawal: invalid status");
        await assetManager.destroyAgent(agentVault.address, recipient, { from: agentOwner1 });
        // assert
        const recovered = (await balance.current(recipient)).sub(startBalance);
        // console.log(`recovered = ${recovered},  rec=${recipient}`);
        assert.isTrue(recovered.gte(amount), `value recovered from agent vault is ${recovered}, which is less than deposited ${amount}`);
    });

    it("only owner can announce collateral withdrawal", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await expectRevert(assetManager.announceCollateralWithdrawal(agentVault.address, 100),
            "only agent vault owner");
    });

    it("cannot annouce collateral withdrawal if agent's status is not 'NORMAL'", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
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
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        const recipient = randomAddress();
        await time.increase(300);
        const startBalance = await balance.current(recipient);
        await agentVault.withdraw(recipient, 100, { from: agentOwner1 });
        // assert
        const withdrawn = (await balance.current(recipient)).sub(startBalance);
        assertWeb3Equal(withdrawn, 100);
    });

    it("should withdraw collateral in a few transactions after announced withdrawal time passes, but not more than announced", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        const recipient = randomAddress();
        await time.increase(300);
        const startBalance = await balance.current(recipient);
        await agentVault.withdraw(recipient, 45, { from: agentOwner1 });
        const withdrawn1 = (await balance.current(recipient)).sub(startBalance);
        await agentVault.withdraw(recipient, 55, { from: agentOwner1 });
        const withdrawn2 = (await balance.current(recipient)).sub(startBalance);
        // assert
        assertWeb3Equal(withdrawn1, 45);
        assertWeb3Equal(withdrawn2, 100);
        await expectRevert(agentVault.withdraw(recipient, 1, { from: agentOwner1 }),
            "withdrawal: more than announced");
    });

    it("only owner can withdraw collateral", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        // assert
        await expectRevert(agentVault.withdraw(agentVault.address, 100),
            "only owner");
    });

    it("should not withdraw collateral if not accounced", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        // assert
        await expectRevert(agentVault.withdraw(agentVault.address, 100, { from: agentOwner1 }),
            "withdrawal: not announced");
    });

    it("should not withdraw collateral before announced withdrawal time passes", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        const recipient = randomAddress();
        await time.increase(150);
        // assert
        await expectRevert(agentVault.withdraw(recipient, 100, { from: agentOwner1 }),
            "withdrawal: not allowed yet");
    });

    it("should not withdraw more collateral than announced", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        const amount = ether('1');
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: agentOwner1 });
        // act
        const recipient = randomAddress();
        await time.increase(300);
        // assert
        await expectRevert(agentVault.withdraw(recipient, 101, { from: agentOwner1 }),
            "withdrawal: more than announced");
    });
    
    it("should change agent's min collateral ratio", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        const collateralRatioBIPS = 23000;
        await assetManager.setAgentMinCollateralRatioBIPS(agentVault.address, collateralRatioBIPS, { from: agentOwner1 });
        // assert
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.agentMinCollateralRatioBIPS, collateralRatioBIPS);
    });

    it("only owner can change agent's min collateral ratio", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        const collateralRatioBIPS = 23000;
        // assert
        await expectRevert(assetManager.setAgentMinCollateralRatioBIPS(agentVault.address, collateralRatioBIPS),
            "only agent vault owner");
    });

    it("should not set too low agent's min collateral ratio", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        const collateralRatioBIPS = 2_1000 - 1;
        // assert
        await expectRevert(assetManager.setAgentMinCollateralRatioBIPS(agentVault.address, collateralRatioBIPS, { from: agentOwner1 }), "collateral ratio too small");
        const info = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(info.agentMinCollateralRatioBIPS, 2_1000);
    });

    it("anyone can call convertDustToTicket", async () => {
        // init
        const agentVault = await createAgent(chain, agentOwner1, underlyingAgent1);
        // act
        // assert
        await assetManager.convertDustToTicket(agentVault.address);
    });
});
