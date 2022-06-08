import { expectRevert, time } from "@openzeppelin/test-helpers";
import { AddressUpdaterInstance, AgentVaultInstance, AssetManagerControllerInstance, AssetManagerInstance, AttestationClientSCInstance, FAssetInstance, FtsoMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { findRequiredEvent } from "../../../utils/events";
import { AssetManagerSettings } from "../../../utils/fasset/AssetManagerTypes";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { getTestFile, toBN, toBNExp } from "../../../utils/helpers";
import { setDefaultVPContract } from "../../../utils/token-test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createTestSettings } from "../test-settings";

const WNat = artifacts.require("WNat");
const AgentVault = artifacts.require("AgentVault");
const AddressUpdater = artifacts.require('AddressUpdater');
const AssetManagerController = artifacts.require('AssetManagerController');
const AttestationClient = artifacts.require('AttestationClientSC');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const MockContract = artifacts.require('MockContract');
const StateConnector = artifacts.require('StateConnectorMock');

contract(`AgentVault.sol; ${getTestFile(__filename)}; AgentVault unit tests`, async accounts => {
    let wnat: WNatInstance;
    let agentVault: AgentVaultInstance;
    let assetManagerController: AssetManagerControllerInstance;
    let addressUpdater: AddressUpdaterInstance;
    let attestationClient: AttestationClientSCInstance;
    let natFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    let settings: AssetManagerSettings;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;

    const owner = accounts[1];
    const governance = accounts[10];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";

    async function createAgent(agentOwner: string, underlyingAddress: string) {
        // create agent
        const response = await assetManager.createAgent(underlyingAddress, { from: agentOwner });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        const agentVaultAddress = event.args.agentVault;
        // get vault contract at this address
        return await AgentVault.at(agentVaultAddress);
    }

    async function createGovernanceVP() {
        const governanceVotePower = await MockContract.new();
        const ownerTokenCall = web3.eth.abi.encodeFunctionCall({ type: 'function', name: 'ownerToken', inputs: [] }, []);
        await governanceVotePower.givenMethodReturnAddress(ownerTokenCall, wnat.address);
        return governanceVotePower;
    }

    beforeEach(async () => {
        // create state connector
        const stateConnector = await StateConnector.new();
        // create atetstation client
        attestationClient = await AttestationClient.new(stateConnector.address);
        // create WNat token
        wnat = await WNat.new(governance, "NetworkNative", "NAT");
        await setDefaultVPContract(wnat, governance);
        // create FTSOs for nat and asset and set some price
        natFtso = await FtsoMock.new("NAT");
        await natFtso.setCurrentPrice(toBNExp(1.12, 5), 0);
        assetFtso = await FtsoMock.new("ETH");
        await assetFtso.setCurrentPrice(toBNExp(3521, 5), 0);
        // create ftso registry
        const ftsoRegistry = await FtsoRegistryMock.new();
        await ftsoRegistry.addFtso(natFtso.address);
        await ftsoRegistry.addFtso(assetFtso.address);
        // create asset manager controller
        addressUpdater = await AddressUpdater.new(governance);
        assetManagerController = await AssetManagerController.new(governance, addressUpdater.address);
        // create asset manager
        settings = createTestSettings(attestationClient, wnat, ftsoRegistry, false);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController.address, "Ethereum", "ETH", 18, settings);
        await assetManagerController.addAssetManager(assetManager.address, { from: governance });
        // create agent vault
        agentVault = await AgentVault.new(assetManager.address, owner);

    });

    it("should deposit from any address", async () => {
        agentVault = await createAgent(owner, underlyingAgent1);
        await agentVault.deposit({ from: owner , value: toBN(100) });
        const votePower = await wnat.votePowerOf(agentVault.address);
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(votePower, 100);
        assertWeb3Equal(agentInfo.totalCollateralNATWei, 100);
        await agentVault.deposit({ from: accounts[2] , value: toBN(1000) });
        const votePower2 = await wnat.votePowerOf(agentVault.address);
        const agentInfo2 = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(votePower2, 1100);
        assertWeb3Equal(agentInfo2.totalCollateralNATWei, 1100);
    });

    it("cannot deposit if agent vault not created through asset manager", async () => {
        const res = agentVault.deposit({ from: owner , value: toBN(100) });
        await expectRevert(res, "invalid agent vault address")
    });

    it("cannot transfer to agent vault if not wnat contract", async () => {
        const res = web3.eth.sendTransaction({ from: owner, to: agentVault.address, value: 500 });
        await expectRevert(res, "only wNat")
    });

    it("cannot withdraw if transfer fails", async () => {
        const tx = await assetManager.createAgent("12345", { from: owner });
        const event = findRequiredEvent(tx, 'AgentCreated');
        agentVault = await AgentVault.at(event.args.agentVault);
        await agentVault.deposit({ from: owner , value: toBN(100) });
        await assetManager.announceCollateralWithdrawal(agentVault.address, 100, { from: owner });
        await time.increase(300);
        await agentVault.withdraw(agentVault.address, 0, { from: owner });
        const res = agentVault.withdraw(agentVault.address, 100, { from: owner });
        await expectRevert(res, "transfer failed")
    });

    it("cannot delegate if not owner", async () => {
        const res = agentVault.delegate(accounts[2], 50);
        await expectRevert(res, "only owner")
    });

    it("should delegate", async () => {
        await agentVault.delegate(accounts[2], 50, { from: owner });
        const { _delegateAddresses } = await wnat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(_delegateAddresses[0], accounts[2]);
    });

    it("should undelegate all", async () => {
        await agentVault.delegate(accounts[2], 50, { from: owner });
        await agentVault.delegate(accounts[3], 10, { from: owner });
        let resDelegate = await wnat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(resDelegate._delegateAddresses.length, 2);

        await agentVault.undelegateAll({ from: owner });
        let resUndelegate = await wnat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(resUndelegate._delegateAddresses.length, 0);
    });

    it("cannot undelegate if not owner", async () => {
        const res = agentVault.undelegateAll({ from: accounts[2] });
        await expectRevert(res, "only owner")
    });

    it("should revoke delegation", async () => {
        await agentVault.delegate(accounts[2], 50, { from: owner });
        const blockNumber = await web3.eth.getBlockNumber();
        await agentVault.revokeDelegationAt(accounts[2], blockNumber, { from: owner });
        let votePower = await wnat.votePowerOfAt(accounts[2], blockNumber);
        assertWeb3Equal(votePower.toNumber(), 0);
    });

    it("cannot revoke delegation if not owner", async () => {
        const blockNumber = await web3.eth.getBlockNumber();
        const res = agentVault.revokeDelegationAt(accounts[2], blockNumber, { from: accounts[2] });
        await expectRevert(res, "only owner")
    });

    it("cannot delegate governance if not owner", async () => {
        const res = agentVault.delegateGovernance(accounts[2]);
        await expectRevert(res, "only owner")
    });

    it("should delegate governance", async () => {
        const governanceVP = await createGovernanceVP();
        await wnat.setGovernanceVotePower(governanceVP.address, { from: governance });
        await agentVault.delegateGovernance(accounts[2], { from: owner });
        const delegate = web3.eth.abi.encodeFunctionCall({type: "function", name: "delegate", 
            inputs: [{name: "_to", type: "address"}]} as AbiItem, 
            [accounts[2]] as any[]);
        const invocationCount = await governanceVP.invocationCountForCalldata.call(delegate);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot undelegate governance if not owner", async () => {
        const res = agentVault.undelegateGovernance();
        await expectRevert(res, "only owner")
    });

    it("should undelegate governance", async () => {
        const governanceVP = await createGovernanceVP();
        await wnat.setGovernanceVotePower(governanceVP.address, { from: governance });
        await agentVault.undelegateGovernance( { from: owner });
        const undelegate = web3.eth.abi.encodeFunctionCall({type: "function", name: "undelegate", 
            inputs: []} as AbiItem, 
            [] as any[]);
        const invocationCount = await governanceVP.invocationCountForCalldata.call(undelegate);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("should claim from reward manager", async () => {
        const rewardManagerMock = await MockContract.new();
        await agentVault.claimReward(rewardManagerMock.address, accounts[5], [1, 5, 7], { from: owner });
        const claimReward = web3.eth.abi.encodeFunctionCall({type: "function", name: "claimReward", 
            inputs: [{name: "_recipient", type: "address"}, {name: "_rewardEpochs", type: "uint256[]"}]} as AbiItem, 
            [accounts[5], [1, 5, 7]] as any[]);
        const invocationCount = await rewardManagerMock.invocationCountForCalldata.call(claimReward);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot claim from reward manager if not owner", async () => {
        const rewardManagerMock = await MockContract.new();
        const claimPromise = agentVault.claimReward(rewardManagerMock.address, accounts[5], [1, 5, 7], { from: accounts[2] });
        await expectRevert(claimPromise, "only owner");
    });

    it("cannot withdraw if not owner", async () => {
        const res = agentVault.withdraw(accounts[2], 100, { from: accounts[2] });
        await expectRevert(res, "only owner")
    });

    it("should call governanceVP.undelegate() when destroying agent if governanceVP contract is set", async () => {
        const governanceVP = await createGovernanceVP();
        await wnat.setGovernanceVotePower(governanceVP.address, { from: governance });
        agentVault = await createAgent(owner, underlyingAgent1);
        await assetManager.announceDestroyAgent(agentVault.address, { from: owner });
        await time.increase(settings.withdrawalWaitMinSeconds);
        await assetManager.destroyAgent(agentVault.address, accounts[2], { from: owner });
        const undelegate = web3.eth.abi.encodeFunctionCall({type: "function", name: "undelegate", 
            inputs: []} as AbiItem, 
            [] as any[]);
        const invocationCount = await governanceVP.invocationCountForCalldata.call(undelegate);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot call destroy if not asset manager", async () => {
        const res = agentVault.destroy(wnat.address, accounts[2], { from: accounts[2] });
        await expectRevert(res, "only asset manager")
    });

    it("cannot call payout if not asset manager", async () => {
        const res = agentVault.payout(wnat.address, accounts[2], 100, { from: accounts[2] });
        await expectRevert(res, "only asset manager")
    });

    it("cannot call payoutNAT if not asset manager", async () => {
        const res = agentVault.payoutNAT(wnat.address, accounts[2], 100, { from: accounts[2] });
        await expectRevert(res, "only asset manager")
    });
});
