import { getTestFile, toWei } from "../../utils/helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "./Agent";
import { AssetContext, CommonContext } from "./AssetContext";
import { testChainInfo } from "./ChainInfo";
import { Minter } from "./Minter";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations`, async accounts => {
    const governance = accounts[10];
    const assetManagerController = accounts[11];
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    const minter1 = accounts[30];
    const underlyingMinter1 = "Minter1";
    
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

        it("mint f-assets", async () => {
            const agent = await Agent.create(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.create(context, minter1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            await agent.depositCollateral(toWei(3e8));
            await agent.makeAvailable(500, 2_2000)
            // update block
            await context.updateUnderlyingBlock();
            // perform minting
            const lots = 3;
            const crt = await minter.reserveCollateral(agent.agentAddress, lots);
            const transaction = await minter.performMintingPayment(crt);
            const minted = await minter.executeMinting(crt, transaction.hash);
            assertWeb3Equal(minted.mintedAmountUBA, context.lotsSize().muln(lots));
            // console.log(`Minted ${formatBN(minted.mintedAmountUBA)}`);
        });
    });
});
