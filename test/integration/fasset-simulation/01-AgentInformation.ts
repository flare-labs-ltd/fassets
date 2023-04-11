import { toWei } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { testChainInfo, testNatInfo } from "../utils/TestChainInfo";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations`, async accounts => {
    const governance = accounts[10];
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const minterAddress1 = accounts[30];
    const minterAddress2 = accounts[31];
    const redeemerAddress1 = accounts[40];
    const redeemerAddress2 = accounts[41];
    const challengerAddress1 = accounts[50];
    const challengerAddress2 = accounts[51];
    const liquidatorAddress1 = accounts[60];
    const liquidatorAddress2 = accounts[61];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingAgent2 = "Agent2";
    const underlyingMinter1 = "Minter1";
    const underlyingMinter2 = "Minter2";
    const underlyingRedeemer1 = "Redeemer1";
    const underlyingRedeemer2 = "Redeemer2";

    let commonContext: CommonContext;
    let context: AssetContext;
    let mockChain: MockChain;
    let mockStateConnectorClient: MockStateConnectorClient;

    beforeEach(async () => {
        commonContext = await CommonContext.createTest(governance, testNatInfo);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        mockChain = context.chain as MockChain;
        mockStateConnectorClient = context.stateConnectorClient as MockStateConnectorClient;
    });

    describe("simple scenarios - get information about agent(s)", () => {
        it("create agent", async () => {
            await Agent.createTest(context, agentOwner1, underlyingAgent1);
        });

        it("get agent info", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            // before making agent public available
            const info = await agent.checkAgentInfo({ totalClass1CollateralWei: 0, freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            assert.isFalse(info.publiclyAvailable);
            assertWeb3Equal(info.dustUBA, 0);
            assertWeb3Equal(info.ccbStartTimestamp, 0);
            assertWeb3Equal(info.liquidationStartTimestamp, 0);
            assertWeb3Equal(info.feeBIPS, 0);
            assertWeb3Equal(info.announcedUnderlyingWithdrawalId, 0);
            assertWeb3Equal(info.mintingClass1CollateralRatioBIPS, context.settings.minCollateralRatioBIPS);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 5_2000);
            const info2 = await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            assert.isTrue(info2.publiclyAvailable);
            assertWeb3Equal(info2.dustUBA, 0);
            assertWeb3Equal(info2.ccbStartTimestamp, 0);
            assertWeb3Equal(info2.liquidationStartTimestamp, 0);
            assertWeb3Equal(info2.feeBIPS, 500);
            assertWeb3Equal(info2.announcedUnderlyingWithdrawalId, 0);
            assertWeb3Equal(info2.agentMinCollateralRatioBIPS, 5_2000);
            // make agent unavailable
            await agent.exitAvailable();
            const info3 = await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            assert.isFalse(info3.publiclyAvailable);
            assertWeb3Equal(info3.dustUBA, 0);
            assertWeb3Equal(info3.ccbStartTimestamp, 0);
            assertWeb3Equal(info3.liquidationStartTimestamp, 0);
            assertWeb3Equal(info3.feeBIPS, 500);
            assertWeb3Equal(info3.announcedUnderlyingWithdrawalId, 0);
            assertWeb3Equal(info3.agentMinCollateralRatioBIPS, 5_2000);
        });

        it("get available agents", async () => {
            const agent1 = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
            const availableAgents1 = await context.assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgents1[0].length, 0);
            assertWeb3Equal(availableAgents1[1], 0);
            const fullAgentCollateral = toWei(3e8);
            await agent1.depositCollateral(fullAgentCollateral);
            await agent1.makeAvailable(500, 2_2000);
            const availableAgents2 = await context.assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgents2[0].length, 1);
            assert.equal(availableAgents2[0][0], agent1.agentVault.address);
            assertWeb3Equal(availableAgents2[1], 1);
            await agent2.depositCollateral(fullAgentCollateral);
            await agent2.makeAvailable(600, 3_2000);
            const availableAgents3 = await context.assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgents3[0].length, 2);
            assert.equal(availableAgents3[0][0], agent1.agentVault.address);
            assert.equal(availableAgents3[0][1], agent2.agentVault.address);
            assertWeb3Equal(availableAgents3[1], 2);
            const availableAgents4 = await context.assetManager.getAvailableAgentsList(0, 1);
            assert.equal(availableAgents4[0].length, 1);
            assert.equal(availableAgents4[0][0], agent1.agentVault.address);
            assertWeb3Equal(availableAgents4[1], 2);
            await agent1.exitAvailable();
            const availableAgents5 = await context.assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgents5[0].length, 1);
            assert.equal(availableAgents5[0][0], agent2.agentVault.address);
            assertWeb3Equal(availableAgents5[1], 1);
            await agent1.makeAvailable(800, 2_5000);
            const availableAgents6 = await context.assetManager.getAvailableAgentsList(0, 10);
            assert.equal(availableAgents6[0].length, 2);
            assert.equal(availableAgents6[0][0], agent2.agentVault.address);
            assert.equal(availableAgents6[0][1], agent1.agentVault.address);
            assertWeb3Equal(availableAgents6[1], 2);
        });

        it("get available agents details", async () => {
            const agent1 = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const agent2 = await Agent.createTest(context, agentOwner2, underlyingAgent2);
            const availableAgents1 = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgents1[0].length, 0);
            assertWeb3Equal(availableAgents1[1], 0);
            const fullAgentCollateral = toWei(3e8);
            await agent1.depositCollateral(fullAgentCollateral);
            await agent1.makeAvailable(500, 2_2000);
            const availableAgents2 = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgents2[0].length, 1);
            assert.equal(availableAgents2[0][0].agentVault, agent1.agentVault.address);
            assertWeb3Equal(availableAgents2[0][0].feeBIPS, 500);
            assertWeb3Equal(availableAgents2[0][0].agentMinCollateralRatioBIPS, 2_2000);
            assertWeb3Equal(availableAgents2[0][0].freeCollateralLots, await agent1.calculateFreeCollateralLots(fullAgentCollateral));
            assertWeb3Equal(availableAgents2[1], 1);
            await agent2.depositCollateral(fullAgentCollateral);
            await agent2.makeAvailable(600, 3_2000);
            const availableAgents3 = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgents3[0].length, 2);
            assert.equal(availableAgents3[0][0].agentVault, agent1.agentVault.address);
            assertWeb3Equal(availableAgents3[0][0].feeBIPS, 500);
            assertWeb3Equal(availableAgents3[0][0].agentMinCollateralRatioBIPS, 2_2000);
            assertWeb3Equal(availableAgents3[0][0].freeCollateralLots, await agent1.calculateFreeCollateralLots(fullAgentCollateral));
            assert.equal(availableAgents3[0][1].agentVault, agent2.agentVault.address);
            assertWeb3Equal(availableAgents3[0][1].feeBIPS, 600);
            assertWeb3Equal(availableAgents3[0][1].agentMinCollateralRatioBIPS, 3_2000);
            assertWeb3Equal(availableAgents3[0][1].freeCollateralLots, await agent2.calculateFreeCollateralLots(fullAgentCollateral));
            assertWeb3Equal(availableAgents3[1], 2);
            const availableAgents4 = await context.assetManager.getAvailableAgentsDetailedList(0, 1);
            assert.equal(availableAgents4[0].length, 1);
            assert.equal(availableAgents4[0][0].agentVault, agent1.agentVault.address);
            assertWeb3Equal(availableAgents4[0][0].feeBIPS, 500);
            assertWeb3Equal(availableAgents4[0][0].agentMinCollateralRatioBIPS, 2_2000);
            assertWeb3Equal(availableAgents4[0][0].freeCollateralLots, await agent1.calculateFreeCollateralLots(fullAgentCollateral));
            assertWeb3Equal(availableAgents4[1], 2);
            await agent1.exitAvailable();
            const availableAgents5 = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgents5[0].length, 1);
            assert.equal(availableAgents5[0][0].agentVault, agent2.agentVault.address);
            assertWeb3Equal(availableAgents5[0][0].feeBIPS, 600);
            assertWeb3Equal(availableAgents5[0][0].agentMinCollateralRatioBIPS, 3_2000);
            assertWeb3Equal(availableAgents5[0][0].freeCollateralLots, await agent2.calculateFreeCollateralLots(fullAgentCollateral));
            assertWeb3Equal(availableAgents5[1], 1);
            await agent1.makeAvailable(800, 2_5000);
            const availableAgents6 = await context.assetManager.getAvailableAgentsDetailedList(0, 10);
            assert.equal(availableAgents6[0].length, 2);
            assert.equal(availableAgents6[0][0].agentVault, agent2.agentVault.address);
            assertWeb3Equal(availableAgents6[0][0].feeBIPS, 600);
            assertWeb3Equal(availableAgents6[0][0].agentMinCollateralRatioBIPS, 3_2000);
            assertWeb3Equal(availableAgents6[0][0].freeCollateralLots, await agent2.calculateFreeCollateralLots(fullAgentCollateral));
            assert.equal(availableAgents6[0][1].agentVault, agent1.agentVault.address);
            assertWeb3Equal(availableAgents6[0][1].feeBIPS, 800);
            assertWeb3Equal(availableAgents6[0][1].agentMinCollateralRatioBIPS, 2_5000);
            assertWeb3Equal(availableAgents6[0][1].freeCollateralLots, await agent1.calculateFreeCollateralLots(fullAgentCollateral));
            assertWeb3Equal(availableAgents6[1], 2);
        });
    });
});
