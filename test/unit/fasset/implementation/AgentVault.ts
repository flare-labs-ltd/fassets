import { expectRevert, time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings, CollateralToken } from "../../../../lib/fasset/AssetManagerTypes";
import { encodeLiquidationStrategyImplSettings } from "../../../../lib/fasset/LiquidationStrategyImpl";
import { findRequiredEvent } from "../../../../lib/utils/events/truffle";
import { toBN } from "../../../../lib/utils/helpers";
import { AddressUpdaterInstance, AgentVaultInstance, AssetManagerControllerInstance, AssetManagerInstance, AttestationClientSCInstance, FAssetInstance, FtsoMockInstance, WNatInstance } from "../../../../typechain-truffle";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createFtsoMock, createTestAgentSettings, createTestCollaterals, createTestContracts, createTestLiquidationSettings, createTestSettings } from "../test-settings";

const AgentVault = artifacts.require("AgentVault");
const MockContract = artifacts.require('MockContract');
const ERC20Mock = artifacts.require("ERC20Mock");


contract(`AgentVault.sol; ${getTestFile(__filename)}; AgentVault unit tests`, async accounts => {
    let wNat: WNatInstance;
    let agentVault: AgentVaultInstance;
    let assetManagerController: AssetManagerControllerInstance;
    let addressUpdater: AddressUpdaterInstance;
    let attestationClient: AttestationClientSCInstance;
    let natFtso: FtsoMockInstance;
    let usdcFtso: FtsoMockInstance;
    let usdtFtso: FtsoMockInstance;
    let assetFtso: FtsoMockInstance;
    let settings: AssetManagerSettings;
    let assetManager: AssetManagerInstance;
    let collaterals: CollateralToken[];
    let fAsset: FAssetInstance;

    const owner = accounts[1];
    const governance = accounts[10];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";

    async function createAgent(agentOwner: string, underlyingAddress: string) {
        // create agent
        const settings = createTestAgentSettings(underlyingAddress);
        const response = await assetManager.createAgent(settings, { from: agentOwner });
        // extract agent vault address from AgentCreated event
        const event = findRequiredEvent(response, 'AgentCreated');
        const agentVaultAddress = event.args.agentVault;
        // get vault contract at this address
        return await AgentVault.at(agentVaultAddress);
    }

    async function createGovernanceVP() {
        const governanceVotePower = await MockContract.new();
        const ownerTokenCall = web3.eth.abi.encodeFunctionCall({ type: 'function', name: 'ownerToken', inputs: [] }, []);
        await governanceVotePower.givenMethodReturnAddress(ownerTokenCall, wNat.address);
        return governanceVotePower;
    }

    beforeEach(async () => {
        const contracts = await createTestContracts(governance);
        // save some contracts as globals
        ({ attestationClient, addressUpdater, wNat, assetManagerController } = contracts);
        // create FTSOs for nat, stablecoins and asset and set some price
        natFtso = await createFtsoMock(contracts.ftsoRegistry, "NAT", 0.42);
        usdcFtso = await createFtsoMock(contracts.ftsoRegistry, "USDC", 1.01);
        usdtFtso = await createFtsoMock(contracts.ftsoRegistry, "USDT", 0.99);
        assetFtso = await createFtsoMock(contracts.ftsoRegistry, "ETH", 1621);
        // create asset manager
        collaterals = createTestCollaterals(contracts);
        settings = createTestSettings(contracts, { requireEOAAddressProof: false });
        const liquidationStrategySettings = encodeLiquidationStrategyImplSettings(createTestLiquidationSettings());
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings, collaterals, liquidationStrategySettings);
        await assetManagerController.addAssetManager(assetManager.address, { from: governance });
        // create agent vault
        agentVault = await AgentVault.new(assetManager.address, owner);
    });

    it("should deposit from any address", async () => {
        agentVault = await createAgent(owner, underlyingAgent1);
        await agentVault.deposit({ from: owner , value: toBN(100) });
        const votePower = await wNat.votePowerOf(agentVault.address);
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(votePower, 100);
        assertWeb3Equal(agentInfo.totalCollateralNATWei, 100);
        await agentVault.deposit({ from: accounts[2] , value: toBN(1000) });
        const votePower2 = await wNat.votePowerOf(agentVault.address);
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

    it("cannot payoutNAT if transfer fails", async () => {
        const AssetManagerMock = artifacts.require("AssetManagerMock");
        const assetManagerMock = await AssetManagerMock.new(wNat.address);
        agentVault = await AgentVault.new(assetManagerMock.address, owner);
        await wNat.depositTo(agentVault.address, { value: toBN(100) });
        await assetManagerMock.payoutNAT(agentVault.address, agentVault.address, 0, { from: owner });
        const res = assetManagerMock.payoutNAT(agentVault.address, agentVault.address, 100, { from: owner });
        await expectRevert(res, "transfer failed")
    });

    it("cannot delegate if not owner", async () => {
        const res = agentVault.delegate(accounts[2], 50);
        await expectRevert(res, "only owner")
    });

    it("should delegate", async () => {
        await agentVault.delegate(accounts[2], 50, { from: owner });
        const { _delegateAddresses } = await wNat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(_delegateAddresses[0], accounts[2]);
    });

    it("should undelegate all", async () => {
        await agentVault.delegate(accounts[2], 50, { from: owner });
        await agentVault.delegate(accounts[3], 10, { from: owner });
        let resDelegate = await wNat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(resDelegate._delegateAddresses.length, 2);

        await agentVault.undelegateAll({ from: owner });
        let resUndelegate = await wNat.delegatesOf(agentVault.address) as any;
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
        let votePower = await wNat.votePowerOfAt(accounts[2], blockNumber);
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
        await wNat.setGovernanceVotePower(governanceVP.address, { from: governance });
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
        await wNat.setGovernanceVotePower(governanceVP.address, { from: governance });
        await agentVault.undelegateGovernance( { from: owner });
        const undelegate = web3.eth.abi.encodeFunctionCall({type: "function", name: "undelegate",
            inputs: []} as AbiItem,
            [] as any[]);
        const invocationCount = await governanceVP.invocationCountForCalldata.call(undelegate);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("should claim ftso rewards", async () => {
        const rewardManagerMock = await MockContract.new();
        await agentVault.claimFtsoRewards(rewardManagerMock.address, [1, 5, 7], { from: owner });
        const claimReward = web3.eth.abi.encodeFunctionCall({type: "function", name: "claimReward",
            inputs: [{name: "_recipient", type: "address"}, {name: "_rewardEpochs", type: "uint256[]"}]} as AbiItem,
            [owner, [1, 5, 7]] as any[]);
        const invocationCount = await rewardManagerMock.invocationCountForCalldata.call(claimReward);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot claim ftso rewards if not owner", async () => {
        const rewardManagerMock = await MockContract.new();
        const claimPromise = agentVault.claimFtsoRewards(rewardManagerMock.address, [1, 5, 7], { from: accounts[2] });
        await expectRevert(claimPromise, "only owner");
    });

    it("should opt out of airdrop distribution", async () => {
        const distributionMock = await MockContract.new();
        await agentVault.optOutOfAirdrop(distributionMock.address, { from: owner });
        const optOutOfAirdrop = web3.eth.abi.encodeFunctionCall({type: "function", name: "optOutOfAirdrop",
            inputs: []} as AbiItem,
            [] as any[]);
        const invocationCount = await distributionMock.invocationCountForCalldata.call(optOutOfAirdrop);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot opt out of airdrop distribution if not owner", async () => {
        const distributionMock = await MockContract.new();
        const optOutOfAirdropPromise = agentVault.optOutOfAirdrop(distributionMock.address, { from: accounts[2] });
        await expectRevert(optOutOfAirdropPromise, "only owner");
    });

    it("should claim airdrop distribution", async () => {
        const distributionMock = await MockContract.new();
        await agentVault.claimAirdropDistribution(distributionMock.address, 2, { from: owner });
        const claim = web3.eth.abi.encodeFunctionCall({type: "function", name: "claim",
            inputs: [{name: "_recipient", type: "address"}, {name: "_month", type: "uint256"}]} as AbiItem,
            [owner, 2] as any[]);
        const invocationCount = await distributionMock.invocationCountForCalldata.call(claim);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot claim airdrop distribution if not owner", async () => {
        const distributionMock = await MockContract.new();
        const claimPromise = agentVault.claimAirdropDistribution(distributionMock.address, 2, { from: accounts[2] });
        await expectRevert(claimPromise, "only owner");
    });

    it("cannot withdraw if not owner", async () => {
        const res = agentVault.withdraw(100, { from: accounts[2] });
        await expectRevert(res, "only owner")
    });

    it("should call governanceVP.undelegate() when destroying agent if governanceVP contract is set", async () => {
        const governanceVP = await createGovernanceVP();
        await wNat.setGovernanceVotePower(governanceVP.address, { from: governance });
        agentVault = await createAgent(owner, underlyingAgent1);
        await assetManager.announceDestroyAgent(agentVault.address, { from: owner });
        await time.increase(settings.withdrawalWaitMinSeconds);
        await assetManager.destroyAgent(agentVault.address, { from: owner });
        const undelegate = web3.eth.abi.encodeFunctionCall({type: "function", name: "undelegate",
            inputs: []} as AbiItem,
            [] as any[]);
        const invocationCount = await governanceVP.invocationCountForCalldata.call(undelegate);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot call destroy if not asset manager", async () => {
        const res = agentVault.destroy(wNat.address, { from: accounts[2] });
        await expectRevert(res, "only asset manager")
    });

    it("cannot call payout if not asset manager", async () => {
        const res = agentVault.payout(wNat.address, accounts[2], 100, { from: accounts[2] });
        await expectRevert(res, "only asset manager")
    });

    it("cannot call payoutNAT if not asset manager", async () => {
        const res = agentVault.payoutNAT(wNat.address, accounts[2], 100, { from: accounts[2] });
        await expectRevert(res, "only asset manager")
    });

    it("should not transfer wnat tokens", async () => {
        let res = agentVault.transferExternalToken(wNat.address, 1, { from: owner });
        await expectRevert(res, "Transfer from wNat not allowed");
    });

    it("should not transfer if not owner", async () => {
        let res = agentVault.transferExternalToken(wNat.address, 1);
        await expectRevert(res, "only owner");
    });

    it("should transfer erc20 tokens", async () => {
        const token = await ERC20Mock.new("XTOK", "XToken")
        await token.mintAmount(agentVault.address, 10);
        let balance = (await token.balanceOf(agentVault.address)).toString();
        assert.equal(balance, "10");
        await agentVault.transferExternalToken(token.address, 3, { from: owner });
        let balance2 = (await token.balanceOf(agentVault.address)).toString();
        assert.equal(balance2, "7");
    });
});
