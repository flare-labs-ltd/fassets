import { expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSettings, AssetManagerSettings, CollateralToken } from "../../../../lib/fasset/AssetManagerTypes";
import { toBN } from "../../../../lib/utils/helpers";
import { AssetManagerControllerInstance, AssetManagerInstance, ERC20MockInstance, FAssetInstance, WNatInstance } from "../../../../typechain-truffle";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createEncodedTestLiquidationSettings, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings, TestFtsos, TestSettingsContracts } from "../test-settings";

const AssetManagerController = artifacts.require('AssetManagerController');
const AgentVault = artifacts.require("AgentVault");
const MockContract = artifacts.require('MockContract');
const ERC20Mock = artifacts.require("ERC20Mock");

contract(`AgentVault.sol; ${getTestFile(__filename)}; AgentVault unit tests`, async accounts => {
    let contracts: TestSettingsContracts;
    let wNat: WNatInstance;
    let stablecoins: Record<string, ERC20MockInstance>;
    let usdc: ERC20MockInstance;
    let assetManagerController: AssetManagerControllerInstance;
    let ftsos: TestFtsos;
    let settings: AssetManagerSettings;
    let assetManager: AssetManagerInstance;
    let collaterals: CollateralToken[];
    let fAsset: FAssetInstance;

    const owner = accounts[1];
    const governance = accounts[10];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";

    function createAgent(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const class1CollateralToken = options?.class1CollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings }, owner, underlyingAddress, class1CollateralToken, options);
    }

    async function createGovernanceVP() {
        const governanceVotePower = await MockContract.new();
        const ownerTokenCall = web3.eth.abi.encodeFunctionCall({ type: 'function', name: 'ownerToken', inputs: [] }, []);
        await governanceVotePower.givenMethodReturnAddress(ownerTokenCall, wNat.address);
        return governanceVotePower;
    }

    beforeEach(async () => {
        const ci = testChainInfo.btc;
        contracts = await createTestContracts(governance);
        // save some contracts as globals
        ({ wNat, stablecoins } = contracts);
        usdc = stablecoins.USDC;
        // create FTSOs for nat, stablecoins and asset and set some price
        ftsos = await createTestFtsos(contracts.ftsoRegistry, ci);
        // create asset manager controller (don't switch to production)
        assetManagerController = await AssetManagerController.new(contracts.governanceSettings.address, governance, contracts.addressUpdater.address);
        // create asset manager
        collaterals = createTestCollaterals(contracts);
        settings = createTestSettings(contracts, ci);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, createEncodedTestLiquidationSettings());
        await assetManagerController.addAssetManager(assetManager.address, { from: governance });
    });

    it("should deposit NAT from any address", async () => {
        const agentVault = await createAgent(owner, underlyingAgent1);
        await agentVault.depositNat({ from: owner , value: toBN(100) });
        const votePower = await wNat.votePowerOf(agentVault.address);
        assertWeb3Equal(votePower, 100);
        await agentVault.depositNat({ from: accounts[2] , value: toBN(1000) });
        const votePower2 = await wNat.votePowerOf(agentVault.address);
        assertWeb3Equal(votePower2, 1100);
    });

    it("should deposit class1 from any address - via approve & depositCollateral", async () => {
        await usdc.mintAmount(owner, 2000);
        const agentVault = await createAgent(owner, underlyingAgent1, { class1CollateralToken: usdc.address });
        await usdc.approve(agentVault.address, 1100, { from: owner });
        await agentVault.depositCollateral(usdc.address, 100, { from: owner });
        const votePower = await wNat.votePowerOf(agentVault.address);
        assertWeb3Equal(votePower, 0);
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(agentInfo.totalClass1CollateralWei, 100);
        await agentVault.depositCollateral(usdc.address, 1000, { from: owner });
        const agentInfo2 = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(agentInfo2.totalClass1CollateralWei, 1100);
    });

    it("should deposit class1 from any address - via transfer & collateralDeposited", async () => {
        await usdc.mintAmount(owner, 2000);
        const agentVault = await createAgent(owner, underlyingAgent1, { class1CollateralToken: usdc.address });
        await usdc.transfer(agentVault.address, 100, { from: owner });
        await agentVault.collateralDeposited(usdc.address, { from: owner });
        const votePower = await wNat.votePowerOf(agentVault.address);
        assertWeb3Equal(votePower, 0);
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(agentInfo.totalClass1CollateralWei, 100);
        await usdc.transfer(agentVault.address, 1000, { from: owner });
        await agentVault.collateralDeposited(usdc.address, { from: owner });
        const agentInfo2 = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(agentInfo2.totalClass1CollateralWei, 1100);
    });

    it("cannot deposit if agent vault not created through asset manager", async () => {
        await usdc.mintAmount(owner, 2000);
        const agentVault = await AgentVault.new(assetManager.address, owner);
        await usdc.approve(agentVault.address, 2000, { from: owner });
        const res = agentVault.depositCollateral(usdc.address, 100, { from: owner });
        await expectRevert(res, "invalid agent vault address")
    });

    it("cannot transfer NAT to agent vault", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const res = web3.eth.sendTransaction({ from: owner, to: agentVault.address, value: 500 });
        await expectRevert(res, "internal use only")
    });

    it("cannot payoutNAT if transfer fails", async () => {
        const AssetManagerMock = artifacts.require("AssetManagerMock");
        const assetManagerMock = await AssetManagerMock.new(wNat.address);
        const agentVault = await AgentVault.new(assetManagerMock.address, owner);
        await wNat.depositTo(agentVault.address, { value: toBN(100) });
        await assetManagerMock.payoutNAT(agentVault.address, agentVault.address, 0, { from: owner });
        const res = assetManagerMock.payoutNAT(agentVault.address, agentVault.address, 100, { from: owner });
        await expectRevert(res, "transfer failed")
    });

    it("cannot delegate if not owner", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const res = agentVault.delegate(wNat.address, accounts[2], 50);
        await expectRevert(res, "only owner")
    });

    it("should delegate", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        await agentVault.delegate(wNat.address, accounts[2], 50, { from: owner });
        const { _delegateAddresses } = await wNat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(_delegateAddresses[0], accounts[2]);
    });

    it("should undelegate all", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        await agentVault.delegate(wNat.address, accounts[2], 50, { from: owner });
        await agentVault.delegate(wNat.address, accounts[3], 10, { from: owner });
        let resDelegate = await wNat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(resDelegate._delegateAddresses.length, 2);

        await agentVault.undelegateAll(wNat.address, { from: owner });
        let resUndelegate = await wNat.delegatesOf(agentVault.address) as any;
        assertWeb3Equal(resUndelegate._delegateAddresses.length, 0);
    });

    it("cannot undelegate if not owner", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const res = agentVault.undelegateAll(wNat.address, { from: accounts[2] });
        await expectRevert(res, "only owner")
    });

    it("should revoke delegation", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        await agentVault.delegate(wNat.address, accounts[2], 50, { from: owner });
        const blockNumber = await web3.eth.getBlockNumber();
        await agentVault.revokeDelegationAt(wNat.address, accounts[2], blockNumber, { from: owner });
        let votePower = await wNat.votePowerOfAt(accounts[2], blockNumber);
        assertWeb3Equal(votePower.toNumber(), 0);
    });

    it("cannot revoke delegation if not owner", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const blockNumber = await web3.eth.getBlockNumber();
        const res = agentVault.revokeDelegationAt(wNat.address, accounts[2], blockNumber, { from: accounts[2] });
        await expectRevert(res, "only owner")
    });

    it("cannot delegate governance if not owner", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const res = agentVault.delegateGovernance(accounts[2]);
        await expectRevert(res, "only owner")
    });

    it("should delegate governance", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
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
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const res = agentVault.undelegateGovernance();
        await expectRevert(res, "only owner")
    });

    it("should undelegate governance", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
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
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const rewardManagerMock = await MockContract.new();
        await agentVault.claimFtsoRewards(rewardManagerMock.address, 5, { from: owner });
        const claimReward = web3.eth.abi.encodeFunctionCall({type: "function", name: "claim",
            inputs: [{ name: "_rewardOwner", type: "address" }, { name: "_recipient", type: "address" }, { name: "_rewardEpoch", type: "uint256" }, { name: "_wrap", type: "bool" }]} as AbiItem,
            [agentVault.address, owner, 5, false] as any[]);
        const invocationCount = await rewardManagerMock.invocationCountForCalldata.call(claimReward);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot claim ftso rewards if not owner", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const rewardManagerMock = await MockContract.new();
        const claimPromise = agentVault.claimFtsoRewards(rewardManagerMock.address, 5, { from: accounts[2] });
        await expectRevert(claimPromise, "only owner");
    });

    it("should opt out of airdrop distribution", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const distributionMock = await MockContract.new();
        await agentVault.optOutOfAirdrop(distributionMock.address, { from: owner });
        const optOutOfAirdrop = web3.eth.abi.encodeFunctionCall({type: "function", name: "optOutOfAirdrop",
            inputs: []} as AbiItem,
            [] as any[]);
        const invocationCount = await distributionMock.invocationCountForCalldata.call(optOutOfAirdrop);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot opt out of airdrop distribution if not owner", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const distributionMock = await MockContract.new();
        const optOutOfAirdropPromise = agentVault.optOutOfAirdrop(distributionMock.address, { from: accounts[2] });
        await expectRevert(optOutOfAirdropPromise, "only owner");
    });

    it("should claim airdrop distribution", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const distributionMock = await MockContract.new();
        await agentVault.claimAirdropDistribution(distributionMock.address, 2, { from: owner });
        const claim = web3.eth.abi.encodeFunctionCall({type: "function", name: "claim",
            inputs: [{ name: "_rewardOwner", type: "address" }, { name: "_recipient", type: "address" }, { name: "_month", type: "uint256" }, { name: "_wrap", type: "bool" }]} as AbiItem,
            [agentVault.address, owner, 2, false] as any[]);
        const invocationCount = await distributionMock.invocationCountForCalldata.call(claim);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot claim airdrop distribution if not owner", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const distributionMock = await MockContract.new();
        const claimPromise = agentVault.claimAirdropDistribution(distributionMock.address, 2, { from: accounts[2] });
        await expectRevert(claimPromise, "only owner");
    });

    it("cannot withdraw collateral if not owner", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const res = agentVault.withdrawCollateral(usdc.address, 100, accounts[2], { from: accounts[2] });
        await expectRevert(res, "only owner")
    });

    it("should call governanceVP.undelegate() when destroying agent if governanceVP was delegated", async () => {
        const governanceVP = await createGovernanceVP();
        await wNat.setGovernanceVotePower(governanceVP.address, { from: governance });
        const agentVault = await createAgent(owner, underlyingAgent1);
        await agentVault.delegateGovernance(accounts[5], { from: owner });
        await assetManager.announceDestroyAgent(agentVault.address, { from: owner });
        await time.increase(settings.withdrawalWaitMinSeconds);
        await assetManager.destroyAgent(agentVault.address, { from: owner });
        const undelegate = web3.eth.abi.encodeFunctionCall({type: "function", name: "undelegate", inputs: []} as AbiItem, []);
        const invocationCount = await governanceVP.invocationCountForCalldata.call(undelegate);
        assert.equal(invocationCount.toNumber(), 1);
    });

    it("cannot call destroy if not asset manager", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const res = agentVault.destroy({ from: accounts[2] });
        await expectRevert(res, "only asset manager")
    });

    it("cannot call payout if not asset manager", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const res = agentVault.payout(wNat.address, accounts[2], 100, { from: accounts[2] });
        await expectRevert(res, "only asset manager")
    });

    it("cannot call payoutNAT if not asset manager", async () => {
        const agentVault = await AgentVault.new(assetManager.address, owner);
        const res = agentVault.payoutNAT(accounts[2], 100, { from: accounts[2] });
        await expectRevert(res, "only asset manager")
    });

    it("should not transfer wnat tokens", async () => {
        const agentVault = await createAgent(owner, underlyingAgent1);
        let res = agentVault.transferExternalToken(wNat.address, 1, { from: owner });
        await expectRevert(res, "only non-collateral tokens");
    });

    it("should not transfer if not owner", async () => {
        const agentVault = await createAgent(owner, underlyingAgent1);
        let res = agentVault.transferExternalToken(wNat.address, 1);
        await expectRevert(res, "only owner");
    });

    it("should transfer erc20 tokens", async () => {
        const agentVault = await createAgent(owner, underlyingAgent1);
        const token = await ERC20Mock.new("XTOK", "XToken")
        await token.mintAmount(agentVault.address, 10);
        let balance = (await token.balanceOf(agentVault.address)).toString();
        assert.equal(balance, "10");
        await agentVault.transferExternalToken(token.address, 3, { from: owner });
        let balance2 = (await token.balanceOf(agentVault.address)).toString();
        assert.equal(balance2, "7");
    });
});
