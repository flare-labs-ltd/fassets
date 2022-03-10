import { getTestFile } from "../../utils/helpers";
import { Agent } from "./Agent";
import { AssetContext, CommonContext, createAssetContext, createCommonContext, testChainInfo } from "./AssetContext";

contract(`AssetManagerSimulation.sol; ${getTestFile(__filename)}; Asset manager simulations`, async accounts => {
    const governance = accounts[10];
    const assetManagerController = accounts[11];
    const agentOwner1 = accounts[20];
    const underlyingAgent1 = "Agent1";  // addresses on mock underlying chain can be any string, as long as it is unique
    
    let commonContext: CommonContext;
    let assetContext: AssetContext;
    
    beforeEach(async () => {
        commonContext = await createCommonContext(governance, assetManagerController);
        assetContext = await createAssetContext(commonContext, testChainInfo.eth);
    });
    
    describe("create agent", () => {
        it("should create agent", async () => {
            // init
            // act
            // assert
            const agent = await Agent.create(assetContext, agentOwner1, underlyingAgent1);
        });
    });
});
