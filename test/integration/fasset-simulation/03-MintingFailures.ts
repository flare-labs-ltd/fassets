import { expectRevert, time } from "@openzeppelin/test-helpers";
import { BN_ZERO, DAYS, MAX_BIPS, toBN, toWei } from "../../../lib/utils/helpers";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../utils/test-helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";
import { Agent } from "../utils/Agent";
import { AssetContext } from "../utils/AssetContext";
import { CommonContext } from "../utils/CommonContext";
import { Minter } from "../utils/Minter";
import { testChainInfo } from "../utils/TestChainInfo";

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

    async function initialize() {
        commonContext = await CommonContext.createTest(governance);
        context = await AssetContext.createTest(commonContext, testChainInfo.eth);
        return { commonContext, context };
    }

    beforeEach(async () => {
        ({ commonContext, context } = await loadFixtureCopyVars(initialize));
        mockChain = context.chain as MockChain;
        mockStateConnectorClient = context.stateConnectorClient as MockStateConnectorClient;
    });

    describe("simple scenarios - minting failures", () => {
        it("mint defaults - no underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // mine a block to skip the agent creation time
            mockChain.mine();
            // update block
            await context.updateUnderlyingBlock();
            // perform collateral
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // test rewarding for mint default
            const startBalanceAgent = await context.wNat.balanceOf(agent.agentVault.address);
            const startBalancePool = await context.wNat.balanceOf(agent.collateralPool.address);
            await agent.mintingPaymentDefault(crt);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            const endBalanceAgent = await context.wNat.balanceOf(agent.agentVault.address);
            const endBalancePool = await context.wNat.balanceOf(agent.collateralPool.address);
            const poolFee = crFee.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(endBalanceAgent.sub(startBalanceAgent), crFee.sub(poolFee));
            assertWeb3Equal(endBalancePool.sub(startBalancePool), poolFee);
            // check that executing minting after calling mintingPaymentDefault will revert
            const txHash = await minter.performMintingPayment(crt);
            await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint defaults - failed underlying payment", async () => {
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform collateral
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            // perform some payment with correct minting reference and wrong amount
            await minter.performPayment(crt.paymentAddress, 100, crt.paymentReference);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // test rewarding for mint default
            const startBalanceAgent = await context.wNat.balanceOf(agent.agentVault.address);
            const startBalancePool = await context.wNat.balanceOf(agent.collateralPool.address);
            await agent.mintingPaymentDefault(crt);
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral, freeUnderlyingBalanceUBA: 0, mintedUBA: 0 });
            const endBalanceAgent = await context.wNat.balanceOf(agent.agentVault.address);
            const endBalancePool = await context.wNat.balanceOf(agent.collateralPool.address);
            const poolFee = crFee.mul(toBN(agent.settings.poolFeeShareBIPS)).divn(MAX_BIPS);
            assertWeb3Equal(endBalanceAgent.sub(startBalanceAgent), crFee.sub(poolFee));
            assertWeb3Equal(endBalancePool.sub(startBalancePool), poolFee);
            // check that executing minting after calling mintingPaymentDefault will revert
            const txHash = await minter.performMintingPayment(crt);
            await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral);
        });

        it("mint unstick - no underlying payment", async () => {
            mockStateConnectorClient.queryWindowSeconds = 300;
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform collateral
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling unstickMinting after no payment will revert if called too soon
            await expectRevert(agent.unstickMinting(crt), "cannot unstick minting yet");
            await time.increase(DAYS);
            context.skipToProofUnavailability(crt.lastUnderlyingBlock, crt.lastUnderlyingTimestamp);
            await agent.checkAgentInfo({
                totalClass1CollateralWei: fullAgentCollateral,
                freeUnderlyingBalanceUBA: 0,
                mintedUBA: 0,
                reservedUBA: context.convertLotsToUBA(lots).add(agent.poolFeeShare(crt.feeUBA)) });
            // test rewarding for unstick default
            const class1Token = agent.class1Token();
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            await agent.unstickMinting(crt);
            const endBalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            // check that class1 collateral was unreserved and given to agent owner
            const class1CollateralPrice = await context.getCollateralPrice(agent.class1Collateral());
            const reservedCollateral = class1CollateralPrice.convertAmgToTokenWei(context.convertLotsToAMG(lots));
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), reservedCollateral);
            assertWeb3Equal(await class1Token.balanceOf(agent.ownerHotAddress), reservedCollateral);
            assert(reservedCollateral.gt(BN_ZERO));
            // check that fee and nat worth of reserved collateral (plus premium) were burned
            const burnedNAT = await agent.class1ToNatBurned(reservedCollateral);
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), burnedNAT.add(crFee));
            await agent.checkAgentInfo({ totalClass1CollateralWei: fullAgentCollateral.sub(reservedCollateral), freeUnderlyingBalanceUBA: 0, mintedUBA: 0, reservedUBA: 0 });
            // check that executing minting after calling unstickMinting will revert
            const txHash = await minter.performMintingPayment(crt);
            await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(reservedCollateral));
        });

        it("mint unstick - failed underlying payment", async () => {
            mockStateConnectorClient.queryWindowSeconds = 300;
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform collateral
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            // perform some payment with correct minting reference and wrong amount
            await minter.performPayment(crt.paymentAddress, 100, crt.paymentReference);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling unstickMinting after failed minting payment will revert if called too soon
            await expectRevert(agent.unstickMinting(crt), "cannot unstick minting yet");
            await time.increase(DAYS);
            context.skipToProofUnavailability(crt.lastUnderlyingBlock, crt.lastUnderlyingTimestamp);
            // test rewarding for unstick default
            const class1Token = agent.class1Token();
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            await agent.unstickMinting(crt);
            const endBalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            // check that class1 collateral was unreserved and given to agent owner
            const class1CollateralPrice = await context.getCollateralPrice(agent.class1Collateral());
            const reservedCollateral = class1CollateralPrice.convertAmgToTokenWei(context.convertLotsToAMG(lots));
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), reservedCollateral);
            assertWeb3Equal(await class1Token.balanceOf(agent.ownerHotAddress), reservedCollateral);
            assert(reservedCollateral.gt(BN_ZERO));
            // check that fee and nat worth of reserved collateral (plus premium) were burned
            const burnedNAT = await agent.class1ToNatBurned(reservedCollateral);
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), burnedNAT.add(crFee));
            // check that executing minting after calling unstickMinting will revert
            const txHash = await minter.performMintingPayment(crt);
            await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(reservedCollateral));
        });

        it("mint unstick - unconfirmed underlying payment", async () => {
            mockStateConnectorClient.queryWindowSeconds = 300;
            const agent = await Agent.createTest(context, agentOwner1, underlyingAgent1);
            const minter = await Minter.createTest(context, minterAddress1, underlyingMinter1, context.underlyingAmount(10000));
            // make agent available
            const fullAgentCollateral = toWei(3e8);
            await agent.depositCollateralsAndMakeAvailable(fullAgentCollateral, fullAgentCollateral);
            // update block
            await context.updateUnderlyingBlock();
            // perform collateral
            const lots = 3;
            const crFee = await minter.getCollateralReservationFee(lots);
            const crt = await minter.reserveCollateral(agent.vaultAddress, lots);
            // perform minting payment without sending proof
            const txHash = await minter.performMintingPayment(crt);
            await context.attestationProvider.provePayment(txHash, minter.underlyingAddress, crt.paymentAddress);
            // mine some blocks to create overflow block
            for (let i = 0; i <= context.chainInfo.underlyingBlocksForPayment; i++) {
                await minter.wallet.addTransaction(minter.underlyingAddress, minter.underlyingAddress, 1, null);
            }
            // check that calling unstickMinting after unconfirmed payment will revert if called too soon
            await expectRevert(agent.unstickMinting(crt), "cannot unstick minting yet");
            await time.increase(DAYS);
            context.skipToProofUnavailability(crt.lastUnderlyingBlock, crt.lastUnderlyingTimestamp);
            // test rewarding for unstick default
            const class1Token = agent.class1Token();
            const burnAddress = (await context.assetManager.getSettings()).burnAddress;
            const startBalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const startBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            await agent.unstickMinting(crt);
            const endBalanceAgent = await class1Token.balanceOf(agent.agentVault.address);
            const endBalanceBurnAddress = toBN(await web3.eth.getBalance(burnAddress));
            // check that class1 collateral was unreserved and given to agent owner
            const class1CollateralPrice = await context.getCollateralPrice(agent.class1Collateral());
            const reservedCollateral = class1CollateralPrice.convertAmgToTokenWei(context.convertLotsToAMG(lots));
            assertWeb3Equal(startBalanceAgent.sub(endBalanceAgent), reservedCollateral);
            assertWeb3Equal(await class1Token.balanceOf(agent.ownerHotAddress), reservedCollateral);
            assert(reservedCollateral.gt(BN_ZERO));
            // check that fee and nat worth of reserved collateral (plus premium) were burned
            const burnedNAT = await agent.class1ToNatBurned(reservedCollateral);
            assertWeb3Equal(endBalanceBurnAddress.sub(startBalanceBurnAddress), burnedNAT.add(crFee));
            // check that executing minting after calling unstickMinting will revert
            await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
            // agent can exit now
            await agent.exitAndDestroy(fullAgentCollateral.sub(reservedCollateral));
        });
    });
});
