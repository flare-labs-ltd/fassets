import { expectRevert, time } from "@openzeppelin/test-helpers";
import { PaymentReference } from "../../../lib/fasset/PaymentReference";
import { EventArgs } from "../../../lib/utils/events/common";
import { requiredEventArgs } from "../../../lib/utils/events/truffle";
import { deepFormat, toWei } from "../../../lib/utils/helpers";
import { web3DeepNormalize } from "../../../lib/utils/web3normalize";
import { RedemptionRequested } from "../../../typechain-truffle/AssetManager";
import { MockChain, MockChainWallet, MockTransactionOptionsWithFee } from "../../utils/fasset/MockChain";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { createTestAgentSettings } from "../../utils/test-settings";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { Challenger } from "../utils/Challenger";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { Redeemer } from "../utils/Redeemer";
import { testChainInfo } from "../utils/TestChainInfo";

const AgentVault = artifacts.require('AgentVault');
const CollateralPool = artifacts.require('CollateralPool');
const CollateralPoolToken = artifacts.require('CollateralPoolToken');

contract(`AuditV2.ts; ${getTestFile(__filename)}; FAsset V2 audit tests`, async accounts => {
    const governance = accounts[10];
    const agentOwner1 = accounts[20];
    const minterAddress1 = accounts[30];
    const redeemerAddress1 = accounts[40];
    const challengerAddress1 = accounts[50];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingOwner1 = "Owner1";
    const underlyingMinter1 = "Minter1";
    const underlyingRedeemer1 = "Redeemer1";

    let commonContext: CommonContext;
    let context: AssetContext;

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        return { commonContext, context };
    }

    beforeEach(async () => {
        ({ commonContext, context } = await loadFixtureCopyVars(initialize));
    });

    it("cannot withdraw when CR is too low", async () => {
        const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
        const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1,
            context.underlyingAmount(10000));
        // make agent available
        await agent.depositCollateralsAndMakeAvailable(toWei(5e5), toWei(1e6));
        // update block
        await context.updateUnderlyingBlock();
        // perform minting
        const lots = 3;
        const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
        const txHash = await minter.performMintingPayment(crt);
        const minted = await minter.executeMinting(crt, txHash);
        // console.log(deepFormat(await agent.getAgentInfo()));
        // announce withdrawal - should succeed
        const withdrawAmount = toWei(2e5);
        const announce = await agent.announceVaultCollateralWithdrawal(withdrawAmount);
        await time.increaseTo(announce.withdrawalAllowedAt);
        // change vault collateral price
        await context.ftsos['USDC'].setCurrentPrice(0.5e5, 0);
        await context.ftsos['USDC'].setCurrentPriceFromTrustedProviders(0.5e5, 0);
        // try to withdraw - should fail because CR is too low
        await expectRevert(agent.withdrawVaultCollateral(withdrawAmount), "withdrawal: CR too low");
    });
});
