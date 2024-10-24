import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { lotSize } from "../../../../lib/fasset/Conversions";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { TX_BLOCKED, TX_FAILED } from "../../../../lib/underlying-chain/interfaces/IBlockChain";
import { EventArgs } from "../../../../lib/utils/events/common";
import { requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { BNish, MAX_BIPS, toBIPS, toBN, toWei } from "../../../../lib/utils/helpers";
import { AgentVaultInstance, ERC20MockInstance, FAssetInstance, IIAssetManagerInstance, WNatInstance } from "../../../../typechain-truffle";
import { CollateralReserved } from "../../../../typechain-truffle/IIAssetManager";
import { testChainInfo } from "../../../integration/utils/TestChainInfo";
import { precomputeContractAddress } from "../../../utils/contract-test-helpers";
import { AgentCollateral } from "../../../utils/fasset/AgentCollateral";
import { AssetManagerInitSettings, newAssetManager } from "../../../utils/fasset/CreateAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockFlareDataConnectorClient } from "../../../utils/fasset/MockFlareDataConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestFtsos, TestSettingsContracts, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings } from "../../../utils/test-settings";
import { assertWeb3Equal } from "../../../utils/web3assertions";

contract(`Minting.sol; ${getTestFile(__filename)}; Minting basic tests`, async accounts => {
    const governance = accounts[10];
    let assetManagerController = accounts[11];
    let contracts: TestSettingsContracts;
    let assetManager: IIAssetManagerInstance;
    let fAsset: FAssetInstance;
    let wNat: WNatInstance;
    let usdc: ERC20MockInstance;
    let ftsos: TestFtsos;
    let settings: AssetManagerInitSettings;
    let collaterals: CollateralType[];
    let chain: MockChain;
    let wallet: MockChainWallet;
    let flareDataConnectorClient: MockFlareDataConnectorClient;
    let attestationProvider: AttestationHelper;

    // addresses
    const agentOwner1 = accounts[20];
    const agentOwner2 = accounts[21];
    const minterAddress1 = accounts[30];
    const executorAddress1 = accounts[41];
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
    const underlyingAgent2 = "Agent2";
    const underlyingMinter1 = "Minter1";
    const underlyingRandomAddress = "Random";

    function createAgent(owner: string, underlyingAddress: string, options?: Partial<AgentSettings>) {
        const vaultCollateralToken = options?.vaultCollateralToken ?? usdc.address;
        return createTestAgent({ assetManager, settings, chain, wallet, attestationProvider }, owner, underlyingAddress, vaultCollateralToken, options);
    }

    async function depositCollateral(owner: string, agentVault: AgentVaultInstance, amount: BN, token: ERC20MockInstance = usdc) {
        await token.mintAmount(owner, amount);
        await token.approve(agentVault.address, amount, { from: owner });
        await agentVault.depositCollateral(token.address, amount, { from: owner });
    }

    async function depositAndMakeAgentAvailable(agentVault: AgentVaultInstance, owner: string, fullAgentCollateral: BN = toWei(3e8)) {
        await depositCollateral(owner, agentVault, fullAgentCollateral);
        await agentVault.buyCollateralPoolTokens({ from: owner, value: fullAgentCollateral });  // add pool collateral and agent pool tokens
        await assetManager.makeAgentAvailable(agentVault.address, { from: owner });
    }

    async function reserveCollateral(agentVault: string, lots: BNish, underlyingAddresses?: string[]) {
        const agentInfo = await assetManager.getAgentInfo(agentVault);
        const crFee = await assetManager.collateralReservationFee(lots);
        const totalNatFee = crFee.add(toWei(0.1));
        const res = await assetManager.reserveCollateral(agentVault, lots, agentInfo.feeBIPS, executorAddress1, underlyingAddresses ?? [],
            { from: minterAddress1, value: totalNatFee });
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

    function getAgentFeeShare(fee: BN, poolFeeShareBIPS: BN) {
        return fee.sub(getPoolFeeShare(fee, poolFeeShareBIPS));
    }

    function getPoolFeeShare(fee: BN, poolFeeShareBIPS: BN) {
        return fee.mul(poolFeeShareBIPS).divn(MAX_BIPS);
    }

    function skipToProofUnavailability(lastUnderlyingBlock: BNish, lastUnderlyingTimestamp: BNish) {
        chain.skipTimeTo(Number(lastUnderlyingTimestamp) + 1);
        chain.mineTo(Number(lastUnderlyingBlock) + 1);
        chain.skipTime(flareDataConnectorClient.queryWindowSeconds + 1);
        chain.mine(chain.finalizationBlocks);
    }

    async function initialize() {
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
        flareDataConnectorClient = new MockFlareDataConnectorClient(contracts.fdcHub, contracts.relay, { [ci.chainId]: chain }, 'auto');
        attestationProvider = new AttestationHelper(flareDataConnectorClient, chain, ci.chainId);
        // create asset manager
        collaterals = createTestCollaterals(contracts, ci);
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        return { contracts, wNat, usdc, ftsos, chain, wallet, flareDataConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset };
    };

    beforeEach(async () => {
        ({ contracts, wNat, usdc, ftsos, chain, wallet, flareDataConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset } = await loadFixtureCopyVars(initialize));
    });

    it("should execute minting (minter)", async () => {
        // init
        const poolFeeShareBIPS = toBIPS(0.4);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { poolFeeShareBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        assertWeb3Equal(event.agentFeeUBA, getAgentFeeShare(toBN(crt.feeUBA), poolFeeShareBIPS));
        assertWeb3Equal(event.poolFeeUBA, getPoolFeeShare(toBN(crt.feeUBA), poolFeeShareBIPS));
        const ticketCreated = requiredEventArgs(res, "RedemptionTicketCreated");
        assertWeb3Equal(ticketCreated.agentVault, agentVault.address);
        assertWeb3Equal(ticketCreated.redemptionTicketId, 1);
        assertWeb3Equal(ticketCreated.ticketValueUBA, crt.valueUBA);
    });

    it("should execute minting (minter, many lots)", async () => {
        // init
        const poolFeeShareBIPS = toBIPS(0.4);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { poolFeeShareBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const crt = await reserveCollateral(agentVault.address, 30);
        const txHash = await performMintingPayment(crt);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        // assert
        const event = requiredEventArgs(res, 'MintingExecuted');
        assertWeb3Equal(event.agentVault, agentVault.address);
        assertWeb3Equal(event.collateralReservationId, crt.collateralReservationId);
        assertWeb3Equal(event.mintedAmountUBA, crt.valueUBA);
        assertWeb3Equal(event.agentFeeUBA, getAgentFeeShare(toBN(crt.feeUBA), poolFeeShareBIPS));
        assertWeb3Equal(event.poolFeeUBA, getPoolFeeShare(toBN(crt.feeUBA), poolFeeShareBIPS));
        const ticketCreated = requiredEventArgs(res, "RedemptionTicketCreated");
        assertWeb3Equal(ticketCreated.agentVault, agentVault.address);
        assertWeb3Equal(ticketCreated.redemptionTicketId, 1);
        const lotSz = lotSize(settings);
        const totalMintedWholeLots = toBN(event.mintedAmountUBA).add(toBN(event.poolFeeUBA)).div(lotSz).mul(lotSz);
        assertWeb3Equal(ticketCreated.ticketValueUBA, totalMintedWholeLots);
    });

    it("should execute minting (agent)", async () => {
        // init
        const poolFeeShareBIPS = toBIPS(0.4);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { poolFeeShareBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        assertWeb3Equal(event.agentFeeUBA, getAgentFeeShare(toBN(crt.feeUBA), poolFeeShareBIPS));
        assertWeb3Equal(event.poolFeeUBA, getPoolFeeShare(toBN(crt.feeUBA), poolFeeShareBIPS));
        const ticketCreated = requiredEventArgs(res, "RedemptionTicketCreated");
        assertWeb3Equal(ticketCreated.agentVault, agentVault.address);
        assertWeb3Equal(ticketCreated.redemptionTicketId, 1);
        assertWeb3Equal(ticketCreated.ticketValueUBA, crt.valueUBA);
    });

    it("should execute minting (executor)", async () => {
        // init
        const poolFeeShareBIPS = toBIPS(0.4);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { poolFeeShareBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const txHash = await performMintingPayment(crt);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const executorBalanceStart = toBN(await web3.eth.getBalance(executorAddress1));
        const res = await assetManager.executeMinting(proof, crt.collateralReservationId, { from: executorAddress1 });
        const executorBalanceEnd = toBN(await web3.eth.getBalance(executorAddress1));
        const gasFee = toBN(res.receipt.gasUsed).mul(toBN(res.receipt.effectiveGasPrice));
        assertWeb3Equal(executorBalanceEnd.sub(executorBalanceStart), toWei(0.1).sub(gasFee));
        // assert
        const event = requiredEventArgs(res, 'MintingExecuted');
        assertWeb3Equal(event.agentVault, agentVault.address);
        assertWeb3Equal(event.collateralReservationId, crt.collateralReservationId);
        assertWeb3Equal(event.mintedAmountUBA, crt.valueUBA);
        assertWeb3Equal(event.agentFeeUBA, getAgentFeeShare(toBN(crt.feeUBA), poolFeeShareBIPS));
        assertWeb3Equal(event.poolFeeUBA, getPoolFeeShare(toBN(crt.feeUBA), poolFeeShareBIPS));
        const ticketCreated = requiredEventArgs(res, "RedemptionTicketCreated");
        assertWeb3Equal(ticketCreated.agentVault, agentVault.address);
        assertWeb3Equal(ticketCreated.redemptionTicketId, 1);
        assertWeb3Equal(ticketCreated.ticketValueUBA, crt.valueUBA);
    });

    it("should not execute minting if not agent or minter or executor", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        const txHash = await performMintingPayment(crt);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        const promise = assetManager.executeMinting(proof, crt.collateralReservationId, { from: accounts[0] });
        // assert
        await expectRevert(promise, "only minter, executor or agent");
    });

    it("should not execute minting if invalid minting reference", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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

    it("should not execute minting if collateral reservation is not approved", async () => {
        // init
        const feeBIPS = toBIPS("50%");
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handshakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const agentVault1 = await createAgent(accounts[123], accounts[234], { feeBIPS: feeBIPS, handshakeType: 0 });
        await depositAndMakeAgentAvailable(agentVault1, accounts[123]);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, constants.ZERO_ADDRESS, [underlyingAgent1], { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandshakeRequired");
        const crt = await reserveCollateral(agentVault1.address, 1);
        const paymentAmount = crt.valueUBA.add(crt.feeUBA).subn(1);
        chain.mint(underlyingMinter1, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingMinter1, crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, underlyingMinter1, crt.paymentAddress);
        // it doesn't matter what kind of proof we provide, the transaction should fail
        const promise = assetManager.executeMinting(proof, args.collateralReservationId, { from: minterAddress1 });
        // assert
        await expectRevert(promise, "collateral reservation not approved");
    });

    it("should not execute minting if invalid minter underlying addresses root", async () => {
        // init
        const feeBIPS = toBIPS("50%");
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handshakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const agentVault2 = await createAgent(agentOwner2, underlyingAgent2, { feeBIPS: feeBIPS, handshakeType: 0 });
        await depositAndMakeAgentAvailable(agentVault2, agentOwner2);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, constants.ZERO_ADDRESS, [underlyingAgent1], { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandshakeRequired");
        const tx1 = await assetManager.approveCollateralReservation(args.collateralReservationId, { from: agentOwner1 });
        const crt = requiredEventArgs(tx1, "CollateralReserved");
        const paymentAmount = crt.valueUBA.add(crt.feeUBA).subn(1);
        chain.mint("wrongUnderlyingMinter", paymentAmount);
        const txHash = await wallet.addTransaction("wrongUnderlyingMinter", crt.paymentAddress, paymentAmount, crt.paymentReference);
        const proof = await attestationProvider.provePayment(txHash, "wrongUnderlyingMinter", crt.paymentAddress);
        const promise = assetManager.executeMinting(proof, crt.collateralReservationId, { from: minterAddress1 });
        // assert
        await expectRevert(promise, "invalid minter underlying addresses root");
    });

    it("should unstick minting", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const crt = await reserveCollateral(agentVault.address, 1);
        skipToProofUnavailability(crt.lastUnderlyingBlock, crt.lastUnderlyingTimestamp);
        // assert
        const proof = await attestationProvider.proveConfirmedBlockHeightExists(Number(settings.attestationWindowSeconds));
        const agentCollateral = await AgentCollateral.create(assetManager, settings, agentVault.address);
        const burnNats = agentCollateral.pool.convertUBAToTokenWei(crt.valueUBA)
            .mul(toBN(settings.vaultCollateralBuyForFlareFactorBIPS)).divn(MAX_BIPS);
        // should provide enough funds
        await expectRevert(assetManager.unstickMinting(proof, crt.collateralReservationId, { from: agentOwner1, value: burnNats.muln(0.99) }),
            "not enough funds provided");
        // succeed when there is enough
        await assetManager.unstickMinting(proof, crt.collateralReservationId, { from: agentOwner1, value: burnNats });
    });

    it("should self-mint", async () => {
        // init
        const feeBIPS = toBIPS("10%");
        const poolFeeShareBIPS = toBIPS(0.4);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS, poolFeeShareBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        const poolFee = paymentAmount.mul(feeBIPS).divn(MAX_BIPS).mul(poolFeeShareBIPS).divn(MAX_BIPS);
        const txHash = await performSelfMintingPayment(agentVault.address, paymentAmount.add(poolFee));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const res = await assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        const event = requiredEventArgs(res, 'MintingExecuted');
        assertWeb3Equal(event.agentVault, agentVault.address);
        assertWeb3Equal(event.collateralReservationId, 0);
        assertWeb3Equal(event.mintedAmountUBA, paymentAmount);
        assertWeb3Equal(event.agentFeeUBA, 0);
        assertWeb3Equal(event.poolFeeUBA, poolFee);
        const ticketCreated = requiredEventArgs(res, "RedemptionTicketCreated");
        assertWeb3Equal(ticketCreated.agentVault, agentVault.address);
        assertWeb3Equal(ticketCreated.redemptionTicketId, 1);
        assertWeb3Equal(ticketCreated.ticketValueUBA, event.mintedAmountUBA);
    });

    it("should self-mint and increase free balance", async () => {
        // init
        const feeBIPS = toBIPS("10%");
        const poolFeeShareBIPS = toBIPS(0.4);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS, poolFeeShareBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 2;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        const txHash = await performSelfMintingPayment(agentVault.address, paymentAmount);
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const res = await assetManager.selfMint(proof, agentVault.address, 1, { from: agentOwner1 });
        // assert
        const event = requiredEventArgs(res, 'MintingExecuted');
        const poolFee = toBN(event.mintedAmountUBA).mul(feeBIPS).divn(MAX_BIPS).mul(poolFeeShareBIPS).divn(MAX_BIPS);
        assertWeb3Equal(event.agentVault, agentVault.address);
        assertWeb3Equal(event.collateralReservationId, 0);
        assertWeb3Equal(event.mintedAmountUBA, paymentAmount.divn(2));
        assertWeb3Equal(event.agentFeeUBA, paymentAmount.divn(2).sub(poolFee));
        assertWeb3Equal(event.poolFeeUBA, poolFee);
        const ticketCreated = requiredEventArgs(res, "RedemptionTicketCreated");
        assertWeb3Equal(ticketCreated.agentVault, agentVault.address);
        assertWeb3Equal(ticketCreated.redemptionTicketId, 1);
        assertWeb3Equal(ticketCreated.ticketValueUBA, event.mintedAmountUBA);
    });

    it("should not self-mint if not agent", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        await depositAndMakeAgentAvailable(agentVault, agentOwner1, toWei(1_000_000));
        // act
        const lots = 10;
        const paymentAmount = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)).muln(lots);
        chain.mint(underlyingRandomAddress, paymentAmount);
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount, PaymentReference.selfMint(agentVault.address));
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "not enough free collateral");
    });

    it("check agent's minting capacity", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1, toWei(1_000_000));
        // act
        const settings = await assetManager.getSettings();
        // console.log("Settings", formatStruct(settings));
        const info = await assetManager.getAgentInfo(agentVault.address);
        // console.log("Agent info", formatStruct(info));
        const ac = await AgentCollateral.create(assetManager, settings, agentVault.address);
        // console.log(`Free lots: ${ac.freeCollateralLots()}`);
        //
        assertWeb3Equal(ac.freeCollateralLots(), info.freeCollateralLots);
        assertWeb3Equal(ac.freeCollateralWei(ac.vault), info.freeVaultCollateralWei);
        assertWeb3Equal(ac.freeCollateralWei(ac.pool), info.freePoolCollateralNATWei);
        assertWeb3Equal(ac.freeCollateralWei(ac.agentPoolTokens), info.freeAgentPoolTokensWei);
    });


    it("should only topup if trying to self-mint 0 lots", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
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
        expectEvent(res, 'MintingExecuted', { agentVault: agentVault.address, collateralReservationId: toBN(0), mintedAmountUBA: toBN(0), agentFeeUBA: paymentAmount });
        assertWeb3Equal(toBN(after.freeUnderlyingBalanceUBA).sub(toBN(before.freeUnderlyingBalanceUBA)), paymentAmount, "invalid self-mint topup value");
    });

    it("should not self-mint if agent's status is not 'NORMAL'", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        //await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        await assetManager.announceDestroyAgent(agentVault.address, { from: agentOwner1});
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
        const feeBIPS = toBIPS("10%");
        const poolFeeShareBIPS = toBIPS(0.4);
        const poolFee = paymentAmount.mul(feeBIPS).divn(MAX_BIPS).mul(poolFeeShareBIPS).divn(MAX_BIPS);
        chain.mint(underlyingRandomAddress, paymentAmount.add(poolFee));
        const nonce = await web3.eth.getTransactionCount(contracts.agentVaultFactory.address);
        const agentVaultAddressCalc = precomputeContractAddress(contracts.agentVaultFactory.address, nonce);
        const txHash = await wallet.addTransaction(underlyingRandomAddress, underlyingAgent1, paymentAmount.add(poolFee), PaymentReference.selfMint(agentVaultAddressCalc));
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS, poolFeeShareBIPS });
        const amount = toWei(3e8);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const proof = await attestationProvider.provePayment(txHash, null, underlyingAgent1);
        const promise = assetManager.selfMint(proof, agentVault.address, lots, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "self-mint payment too old");
    });
});
