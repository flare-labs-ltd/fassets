import { balance, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { ethers } from "hardhat";
import { AgentSettings, AssetManagerSettings, CollateralToken } from "../../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { TX_BLOCKED, TX_FAILED } from "../../../../lib/underlying-chain/interfaces/IBlockChain";
import { EventArgs } from "../../../../lib/utils/events/common";
import { requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { BNish, toBN, toWei } from "../../../../lib/utils/helpers";
import { AssetManagerInstance, ERC20MockInstance, FAssetInstance, WNatInstance } from "../../../../typechain-truffle";
import { CollateralReserved } from "../../../../typechain-truffle/AssetManager";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { newAssetManager } from "../../../utils/fasset/DeployAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile } from "../../../utils/test-helpers";
import { assertWeb3Equal } from "../../../utils/web3assertions";
import { createEncodedTestLiquidationSettings, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings, TestFtsos, TestSettingOptions, TestSettingsContracts } from "../test-settings";

contract(`Minting.sol; ${getTestFile(__filename)}; Minting basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let contracts: TestSettingsContracts;
    let assetManager: AssetManagerInstance;
    let fAsset: FAssetInstance;
    let wNat: WNatInstance;
    let usdc: ERC20MockInstance;
    let ftsos: TestFtsos;
    let settings: AssetManagerSettings;
    let collaterals: CollateralToken[];
    let chain: MockChain;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;

    // addresses
    const agentOwner1 = accounts[20];
    const minterAddress1 = accounts[30];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingMinter1 = "Minter1";
    const underlyingRandomAddress = "Random";

    function createAgent(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const class1CollateralToken = options?.class1CollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings, chain, wallet, attestationProvider }, owner, underlyingAddress, class1CollateralToken, options);
    }

    async function reserveCollateral(agentVault: string, lots: BNish) {
        const agentInfo = await assetManager.getAgentInfo(agentVault);
        const crFee = await assetManager.collateralReservationFee(lots);
        const res = await assetManager.reserveCollateral(agentVault, lots, agentInfo.feeBIPS, { from: minterAddress1, value: crFee });
        return requiredEventArgs(res, 'CollateralReserved');
    }

    async function performMintingPayment(crt: EventArgs<CollateralReserved>) {
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        chain.mint(underlyingMinter1, paymentAmount);
        return await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
    }

    async function performSelfMintingPayment(agentVault: string, paymentAmount: BNish) {
        chain.mint(underlyingRandomAddress, paymentAmount);
        return await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVault));
    }

    beforeEach(async () => {
        const ci = testChainInfo.eth;
        contracts = await createTestContracts(governance);
        // save some contracts as globals
        ({ wNat } = contracts);
        usdc = contracts.stablecoins.USDC;
        // create FTSOs for nat, stablecoins and asset and set some price
        ftsos = await createTestFtsos(contracts.ftsoRegistry, ci);
        // create mock chain and attestation provider
        chain = new MockChain(await time.latest());
        wallet = new MockChainWallet(chain);
        stateConnectorClient = new MockStateConnectorClient(contracts.stateConnector, { [ci.chainId]: chain }, 'auto');
        attestationProvider = new AttestationHelper(stateConnectorClient, chain, ci.chainId);
        // create asset manager
        collaterals = createTestCollaterals(contracts);
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, createEncodedTestLiquidationSettings());
    });

    it("should execute minting (minter)", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const txHash = await performMintingPayment(crt);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        // assert
        const event = requiredEventArgs(res, 'MintingExecuted');
        assertWeb3Equal(event.agentVault, agentVault.address);
        assertWeb3Equal(event.collateralReservationId, crt.collateralReservationId);
        assertWeb3Equal(event.mintedAmountUBA, crt.valueUBA);
        assertWeb3Equal(event.receivedFeeUBA, crt.feeUBA);
        assertWeb3Equal(event.redemptionTicketId, 1);
    });

    it("should execute minting (agent)", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const txHash = await performMintingPayment(crt);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: agentOwner1 });
        // assert
        const event = requiredEventArgs(res, 'MintingExecuted');
        assertWeb3Equal(event.agentVault, agentVault.address);
        assertWeb3Equal(event.collateralReservationId, crt.collateralReservationId);
        assertWeb3Equal(event.mintedAmountUBA, crt.valueUBA);
        assertWeb3Equal(event.receivedFeeUBA, crt.feeUBA);
        assertWeb3Equal(event.redemptionTicketId, 1);
    });

    it("should not execute minting if not agent or minter", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const txHash = await performMintingPayment(crt);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const promise = assetManager.executeMinting(proof, crt.collateralReservationId, { from: accounts[0] });
        // assert
        await expectRevert(promise, "only minter or agent");
    });

    it("should not execute minting if invalid minting reference", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        chain.mint(underlyingMinter1, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, PaymentReference.redemption(crt.collateralReservationId));
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const promise = assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        // assert
        await expectRevert(promise, "invalid minting reference");
    });

    it("should not execute minting if minting payment failed", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        chain.mint(underlyingMinter1, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference, {status: TX_FAILED});
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const promise = assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        // assert
        await expectRevert(promise, "payment failed");
    });

    it("should not execute minting if minting payment blocked", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        chain.mint(underlyingMinter1, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference, {status: TX_BLOCKED});
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const promise = assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        // assert
        await expectRevert(promise, "payment failed");
    });

    it("should not execute minting if not minting agent's address", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        chain.mint(underlyingMinter1, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingMinter1, underlyingRandomAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, underlyingRandomAddress);
        const promise = assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        // assert
        await expectRevert(promise, "not minting agent's address");
    });

    it("should not execute minting if minting payment too small", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const paymentAmount = crt.valueUBA.add(crt.feeUBA).subn(1);
        chain.mint(underlyingMinter1, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const promise = assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        // assert
        await expectRevert(promise, "minting payment too small");
    });

    it("should execute minting and burn crf to protected address", async () => {
        // create asset manager with special burn address
        const options: TestSettingOptions = {
            burnAddress: "0x0100000000000000000000000000000000000000",
            burnWithSelfDestruct: true
        };
        settings = createTestSettings(agentVaultFactory, attestationClient, wNat, ftsoRegistry, options);
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, "Ethereum", "ETH", 18, settings);
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const crFee = await assetManager.collateralReservationFee(1);
        const crt = await reserveCollateral(agentVault.address, 1);
        const txHash = await performMintingPayment(crt);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        // assert
        const event = requiredEventArgs(res, 'MintingExecuted');
        const burned = await balance.current(options.burnAddress!);
        assertWeb3Equal(event.agentVault, agentVault.address);
        assertWeb3Equal(event.collateralReservationId, crt.collateralReservationId);
        assertWeb3Equal(event.mintedAmountUBA, crt.valueUBA);
        assertWeb3Equal(event.receivedFeeUBA, crt.feeUBA);
        assertWeb3Equal(event.redemptionTicketId, 1);
        assertWeb3Equal(burned, crFee);
    });

    it("should self-mint", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        const txHash = await performSelfMintingPayment(agentVault.address, paymentAmount);
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const res = await assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        const event = requiredEventArgs(res, 'MintingExecuted');
        assertWeb3Equal(event.agentVault, agentVault.address);
        assertWeb3Equal(event.collateralReservationId, 0);
        assertWeb3Equal(event.mintedAmountUBA, paymentAmount);
        assertWeb3Equal(event.receivedFeeUBA, 0);
        assertWeb3Equal(event.redemptionTicketId, 1);
    });

    it("should self-mint and increase free balance", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        const txHash = await performSelfMintingPayment(agentVault.address, paymentAmount);
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const res = await assetManager.selfMint(proof, agentVault.address, 1, { from: agentOwner1 });
        // assert
        const event = requiredEventArgs(res, 'MintingExecuted');
        assertWeb3Equal(event.agentVault, agentVault.address);
        assertWeb3Equal(event.collateralReservationId, 0);
        assertWeb3Equal(event.mintedAmountUBA, paymentAmount.divn(2));
        assertWeb3Equal(event.receivedFeeUBA, paymentAmount.divn(2));
        assertWeb3Equal(event.redemptionTicketId, 1);
    });

    it("should not self-mint if not agent", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        const txHash = await performSelfMintingPayment(agentVault.address, paymentAmount);
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: accounts[0] });
        // assert
        await expectRevert(promise, "only agent vault owner");
    });

    it("should not self-mint if invalid self-mint reference", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentOwner1));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "invalid self-mint reference");
    });

    it("should not self-mint if payment failed", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVault.address), {status: TX_FAILED});
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "payment failed");
    });

    it("should not self-mint if payment blocked", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVault.address), {status: TX_BLOCKED});
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "payment failed");
    });

    it("should not self-mint if not agent's address", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingMinter1, paymentAmount, PaymentReference.selfMint(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingMinter1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "self-mint not agent's address");
    });

    it("should not self-mint if self-mint payment too small", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots).subn(1);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "self-mint payment too small");
    });

    it("should not self-mint if not enough free collateral", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots).subn(1);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, 5000, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "not enough free collateral");
    });

    it("should only topup if trying to self-mint 0 lots", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.makeAgentAvailable(agentVault.address, 500, 22000, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots).subn(1);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const before = await assetManager.getAgentInfo(agentVault.address);
        const res = await assetManager.selfMint(proof, agentVault.address, 0, { from: agentOwner1 });
        const after = await assetManager.getAgentInfo(agentVault.address);
        // assert
        expectEvent(res, 'MintingExecuted', { agentVault: agentVault.address, collateralReservationId: toBN(0), mintedAmountUBA: toBN(0), receivedFeeUBA: paymentAmount });
        assertWeb3Equal(toBN(after.freeUnderlyingBalanceUBA).sub(toBN(before.freeUnderlyingBalanceUBA)), paymentAmount, "invalid self-mint topup value");
    });

    it("should not self-mint if agent's status is not 'NORMAL'", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1 });
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots).subn(1);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "self-mint invalid agent status");
    });

    it("should not self-mint if self-mint payment too old", async () => {
        // init
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const nonce = await ethers.provider.getTransactionCount(agentVaultFactory.address);
        let agentVaultAddressCalc = ethers.utils.getContractAddress({from: agentVaultFactory.address, nonce: nonce});
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVaultAddressCalc));

        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        const amount = toWei(3e8);
        await agentVault.deposit({ from: agentOwner1, value: amount });
        // act
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "self-mint payment too old");
    });
});
