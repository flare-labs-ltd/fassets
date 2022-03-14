import { time } from "@openzeppelin/test-helpers";
import { getTestFile, toWei } from "../../utils/helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "./Agent";
import { AssetContext, CommonContext } from "./AssetContext";
import { testChainInfo } from "./ChainInfo";
import { Minter } from "./Minter";
import { Redeemer } from "./Redeemer";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations`, async accounts => {
    const governance = accounts[10];
    const assetManagerController = accounts[11];
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const minter1 = accounts[30];
    const underlyingMinter1 = "Minter1";
    const redeemer1 = accounts[40];
    const underlyingRedeemer1 = "Redeemer1";
    
    let commonContext: CommonContext;
    let context: AssetContext;
    
    beforeEach(async () => {
        commonContext = await CommonContext.create(governance, assetManagerController);
        context = await AssetContext.create(commonContext, testChainInfo.eth);
    });
    
    describe("simple scenarios", () => {
        it("create agent", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
        });

        it("mint and redeem f-assets", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.create(context, minter1, underlyingMinter1, context.underlyingAmount(10000));
            const redeemer = await Redeemer.create(context, redeemer1, underlyingRedeemer1);
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateral(fullAgentCollateral);
            await agent.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            const transaction = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, transaction.hash);
            assertWeb3Equal(minted.mintedAmountUBA, context.lotsSize().muln(lots));
            // redeemer "buys" f-assets
            await context.fAsset.transfer(redeemer.address, minted.mintedAmountUBA, { from: minter.address });
            // perform redemption
            const [redemptionRequests, remainingLots] = await redeemer.requestRedemption(lots);
            assertWeb3Equal(remainingLots, 0);
            assert.equal(redemptionRequests.length, 1);
            for (const request of redemptionRequests) {
                assert.equal(request.agentVault, agent.vaultAddress);
                const transaction = await agent.performRedemptionPayment(request);
                await agent.confirmRedemptionPayment(request, transaction.hash);
            }
            // agent can exit now
            await agent.exitAvailable();
            await agent.announceWithdrawal(fullAgentCollateral);
            await time.increase(300);
            await agent.destroy();
        });
    });
});
