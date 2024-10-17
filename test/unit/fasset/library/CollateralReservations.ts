import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import { AgentSettings, CollateralType } from "../../../../lib/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../../lib/fasset/PaymentReference";
import { AttestationHelper } from "../../../../lib/underlying-chain/AttestationHelper";
import { EventArgs } from "../../../../lib/utils/events/common";
import { requiredEventArgs } from "../../../../lib/utils/events/truffle";
import { BNish, toBN, toWei } from "../../../../lib/utils/helpers";
import { AgentVaultInstance, ERC20MockInstance, FAssetInstance, IIAssetManagerInstance, WNatInstance } from "../../../../typechain-truffle";
import { CollateralReserved } from "../../../../typechain-truffle/IIAssetManager";
import { TestChainInfo, testChainInfo } from "../../../integration/utils/TestChainInfo";
import { AssetManagerInitSettings, newAssetManager } from "../../../utils/fasset/CreateAssetManager";
import { MockChain, MockChainWallet } from "../../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../../utils/fasset/MockStateConnectorClient";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestFtsos, TestSettingsContracts, createTestAgent, createTestCollaterals, createTestContracts, createTestFtsos, createTestSettings } from "../../../utils/test-settings";
import { assertWeb3Equal } from "../../../utils/web3assertions";

contract(`CollateralReservations.sol; ${getTestFile(__filename)}; CollateralReservations basic tests`, async accounts => {
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
    let chainInfo: TestChainInfo;
    let wallet: MockChainWallet;
    let stateConnectorClient: MockStateConnectorClient;
    let attestationProvider: AttestationHelper;

    const feeBIPS = 500;

    // addresses
    const agentOwner1 = accounts[20];
    const minterAddress1 = accounts[30];
    const noExecutorAddress = constants.ZERO_ADDRESS;
    // addresses on mock underlying chain can be any string, as long as it is unique
    const underlyingAgent1 = "Agent1";
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
        const res = await assetManager.reserveCollateral(agentVault, lots, agentInfo.feeBIPS, noExecutorAddress, underlyingAddresses ?? [], { from: minterAddress1, value: crFee });
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

    async function initialize() {
        const ci = chainInfo = testChainInfo.eth;
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
        collaterals = createTestCollaterals(contracts, ci);
        settings = createTestSettings(contracts, ci, { requireEOAAddressProof: true });
        [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, ci.name, ci.symbol, ci.decimals, settings, collaterals, ci.assetName, ci.assetSymbol);
        return { contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset };
    }

    beforeEach(async () => {
        ({ contracts, wNat, usdc, ftsos, chain, wallet, stateConnectorClient, attestationProvider, collaterals, settings, assetManager, fAsset } = await loadFixtureCopyVars(initialize));
    });

    it("should reserve collateral", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, [], { from: minterAddress1, value: crFee });
        // assert
        const settings = await assetManager.getSettings();
        const lotSize = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
        const args = requiredEventArgs(tx, "CollateralReserved");
        assertWeb3Equal(args.agentVault, agentVault.address);
        assert.isAbove(Number(args.collateralReservationId), 0);
        assertWeb3Equal(args.minter, minterAddress1);
        assertWeb3Equal(args.paymentAddress, underlyingAgent1);
        assertWeb3Equal(args.paymentReference, PaymentReference.minting(args.collateralReservationId));
        assertWeb3Equal(args.valueUBA, lotSize.muln(lots));
        assertWeb3Equal(args.feeUBA, lotSize.muln(lots * feeBIPS).divn(10000));
    });

    it("should reserve collateral and require a hand-shake", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        const agentInfo = await assetManager.getAgentInfo(agentVault.address);
        assertWeb3Equal(agentInfo.handShakeType, 1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        // assert
        const settings = await assetManager.getSettings();
        const lotSize = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
        const args = requiredEventArgs(tx, "HandShakeRequired");
        assertWeb3Equal(args.agentVault, agentVault.address);
        assert.isAbove(Number(args.collateralReservationId), 0);
        assertWeb3Equal(args.minter, minterAddress1);
        assertWeb3Equal(args.valueUBA, lotSize.muln(lots));
        assertWeb3Equal(args.feeUBA, lotSize.muln(lots * feeBIPS).divn(10000));
    });

    it("should reserve collateral, require a hand-shake and approve reservation", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandShakeRequired");
        const settings = await assetManager.getSettings();
        const lotSize = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
        // approve reservation
        const tx1 = await assetManager.approveCollateralReservation(args.collateralReservationId, { from: agentOwner1 });
        const args1 = requiredEventArgs(tx1, "CollateralReserved");
        assertWeb3Equal(args1.agentVault, agentVault.address);
        assert.isAbove(Number(args1.collateralReservationId), 0);
        assertWeb3Equal(args1.minter, minterAddress1);
        assertWeb3Equal(args1.paymentAddress, underlyingAgent1);
        assertWeb3Equal(args1.paymentReference, PaymentReference.minting(args.collateralReservationId));
        assertWeb3Equal(args1.valueUBA, lotSize.muln(lots));
        assertWeb3Equal(args1.feeUBA, lotSize.muln(lots * feeBIPS).divn(10000));
    });

    it("should revert approving collateral reservation if not called by the agent", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandShakeRequired");
        await expectRevert(assetManager.approveCollateralReservation(args.collateralReservationId), "only agent vault owner");
    });

    it("should revert approving collateral reservation if hand-shake not required", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 0 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "CollateralReserved");
        await expectRevert(assetManager.approveCollateralReservation(args.collateralReservationId, { from: agentOwner1 }), "hand-shake not required");
    });

    it("should reserve collateral, require a hand-shake and reject reservation", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandShakeRequired");
        // reject reservation
        const minterBalanceBefore = await web3.eth.getBalance(minterAddress1);
        await assetManager.rejectCollateralReservation(args.collateralReservationId, { from: agentOwner1 });
        const minterBalanceAfter = await web3.eth.getBalance(minterAddress1);
        assertWeb3Equal(toBN(minterBalanceBefore).add(crFee), minterBalanceAfter);
    });

    it("should revert rejecting reservation if already approved", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandShakeRequired");
        // approve reservation
        const tx1 = await assetManager.approveCollateralReservation(args.collateralReservationId, { from: agentOwner1 });
        requiredEventArgs(tx1, "CollateralReserved");
        await expectRevert(assetManager.rejectCollateralReservation(args.collateralReservationId, { from: agentOwner1 }), "hand-shake not required or collateral reservation already approved");
    });

    it("should cancel collateral reservation", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandShakeRequired");
        // move time for cancelCollateralReservationAfterSeconds
        await time.increase(Number(settings.cancelCollateralReservationAfterSeconds));
        // cancel reservation
        const minterBalanceBefore = await web3.eth.getBalance(minterAddress1);
        const tx1 = await assetManager.cancelCollateralReservation(args.collateralReservationId, { from: minterAddress1 });
        const minterBalanceAfter = await web3.eth.getBalance(minterAddress1);
        assertWeb3Equal(toBN(minterBalanceBefore).add(crFee).sub(toBN(tx1.receipt.gasUsed).mul(toBN(tx1.receipt.effectiveGasPrice))), minterBalanceAfter);
    });

    it("should not cancel collateral reservation if not called by minter", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandShakeRequired");
        // try to cancel reservation
        await expectRevert(assetManager.cancelCollateralReservation(args.collateralReservationId), "only minter");
    });

    it("should not cancel collateral reservation if already approved", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandShakeRequired");
        // approve reservation
        await assetManager.approveCollateralReservation(args.collateralReservationId, { from: agentOwner1 });
        // try to cancel reservation
        await expectRevert(assetManager.cancelCollateralReservation(args.collateralReservationId, { from: minterAddress1 }), "collateral reservation already approved");
    });

    it("should not cancel collateral reservation if called to early", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandShakeRequired");
        // try to cancel reservation
        await expectRevert(assetManager.cancelCollateralReservation(args.collateralReservationId, { from: minterAddress1 }), "collateral reservation cancellation too early");
    });

    it("should not reserve collateral if agent not available", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const promise = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, [], { from: minterAddress1, value: crFee });
        // assert
        await expectRevert(promise, "agent not in mint queue");
    });

    it("should not reserve collateral if trying to mint 0 lots", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const promise = assetManager.reserveCollateral(agentVault.address, 0, feeBIPS, noExecutorAddress, [], { from: minterAddress1, value: crFee });
        // assert
        await expectRevert(promise, "cannot mint 0 lots");
    });

    it("should not reserve collateral if agent's status is not 'NORMAL'", async () => {
        // init
        chain.mint(underlyingAgent1, 100);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const tx = await wallet.addTransaction(underlyingAgent1, underlyingRandomAddress, 100, null);
        const proof = await attestationProvider.proveBalanceDecreasingTransaction(tx, underlyingAgent1);
        await assetManager.illegalPaymentChallenge(proof, agentVault.address);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const promise = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, [], { from: minterAddress1, value: crFee });
        // assert
        await expectRevert(promise, "rc: invalid agent status");
    });

    it("should not reserve collateral if not enough free collateral", async () => {
        // init
        chain.mint(underlyingAgent1, 100);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 500000000;
        const crFee = await assetManager.collateralReservationFee(lots);
        const promise = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, [], { from: minterAddress1, value: crFee });
        // assert
        await expectRevert(promise, "not enough free collateral");
    });

    it("should not reserve collateral if agent's fee is too high", async () => {
        // init
        chain.mint(underlyingAgent1, 100);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const promise = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS - 1, noExecutorAddress, [], { from: minterAddress1, value: crFee });
        // assert
        await expectRevert(promise, "agent's fee too high");
    });

    it("should not reserve collateral if inappropriate fee amount is sent", async () => {
        // init
        chain.mint(underlyingAgent1, 100);
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        // act
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        // assert
        const promise1 = assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, [], { from: minterAddress1, value: crFee.subn(1) });
        await expectRevert(promise1, "inappropriate fee amount");
    });

    it("should not default minting if minting non-payment mismatch", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const crt = await reserveCollateral(agentVault.address, 3);
        // mine some blocks to create overflow block
        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }
        // act
        // wrong address
        const proofAddress = await attestationProvider.proveReferencedPaymentNonexistence(
            underlyingMinter1, crt.paymentReference, crt.valueUBA.add(crt.feeUBA),
            crt.firstUnderlyingBlock.toNumber(), crt.lastUnderlyingBlock.toNumber(), crt.lastUnderlyingTimestamp.toNumber());
        const promiseAddress = assetManager.mintingPaymentDefault(proofAddress, crt.collateralReservationId, { from: agentOwner1 });
        await expectRevert(promiseAddress, "minting non-payment mismatch");
        // wrong reference
        const proofReference = await attestationProvider.proveReferencedPaymentNonexistence(
            underlyingAgent1, PaymentReference.minting(crt.collateralReservationId.addn(1)), crt.valueUBA.add(crt.feeUBA),
            crt.firstUnderlyingBlock.toNumber(), crt.lastUnderlyingBlock.toNumber(), crt.lastUnderlyingTimestamp.toNumber());
        const promiseReference = assetManager.mintingPaymentDefault(proofReference, crt.collateralReservationId, { from: agentOwner1 });
        await expectRevert(promiseReference, "minting non-payment mismatch");
        // wrong amount
        const proofAmount = await attestationProvider.proveReferencedPaymentNonexistence(
            underlyingAgent1, crt.paymentReference, crt.valueUBA.add(crt.feeUBA).addn(1),
            crt.firstUnderlyingBlock.toNumber(), crt.lastUnderlyingBlock.toNumber(), crt.lastUnderlyingTimestamp.toNumber());
        const promiseAmount = assetManager.mintingPaymentDefault(proofAmount, crt.collateralReservationId, { from: agentOwner1 });
        await expectRevert(promiseAmount, "minting non-payment mismatch");
    });

    it("should not default minting if called too early", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const crt = await reserveCollateral(agentVault.address, 3);
        // mine some blocks to create overflow block
        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }
        // act
        // wrong overflow block
        const proofOverflow = await attestationProvider.proveReferencedPaymentNonexistence(
            underlyingAgent1, crt.paymentReference, crt.valueUBA.add(crt.feeUBA),
            crt.firstUnderlyingBlock.toNumber(), crt.lastUnderlyingBlock.toNumber() - 1, crt.lastUnderlyingTimestamp.toNumber() - chainInfo.blockTime * 2);
        const promiseOverflow = assetManager.mintingPaymentDefault(proofOverflow, crt.collateralReservationId, { from: agentOwner1 });
        // assert
        await expectRevert(promiseOverflow, "minting default too early");
    });

    it("should not default minting if reservation not approved", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandShakeRequired");
        const agentVault1 = await createAgent(accounts[123], accounts[234], { feeBIPS: feeBIPS, handShakeType: 0 });
        await depositAndMakeAgentAvailable(agentVault1, accounts[123]);
        const crt = await reserveCollateral(agentVault1.address, 3);
        // it doesn't matter if the proof is correct
        for (let i = 0; i <= chainInfo.underlyingBlocksForPayment * 25; i++) {
            await wallet.addTransaction(underlyingMinter1, underlyingMinter1, 1, null);
        }
        const proof = await attestationProvider.proveReferencedPaymentNonexistence(
            accounts[234], crt.paymentReference, crt.valueUBA.add(crt.feeUBA),
            crt.firstUnderlyingBlock.toNumber(), crt.lastUnderlyingBlock.toNumber() - 1, crt.lastUnderlyingTimestamp.toNumber() - chainInfo.blockTime * 2);
        const promise = assetManager.mintingPaymentDefault(proof, args.collateralReservationId, { from: agentOwner1 });
        // assert
        await expectRevert(promise, "collateral reservation not approved");
    });

    it("should not unstick minting if collateral reservation is not approved", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1, { feeBIPS: feeBIPS, handShakeType: 1 });
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const lots = 1;
        const crFee = await assetManager.collateralReservationFee(lots);
        const tx = await assetManager.reserveCollateral(agentVault.address, lots, feeBIPS, noExecutorAddress, { from: minterAddress1, value: crFee });
        const args = requiredEventArgs(tx, "HandShakeRequired");
        const agentVault1 = await createAgent(accounts[123], accounts[234], { feeBIPS: feeBIPS, handShakeType: 0 });
        const proof = await attestationProvider.proveConfirmedBlockHeightExists(Number(settings.attestationWindowSeconds));
        await depositAndMakeAgentAvailable(agentVault1, accounts[123]);
        // should provide enough funds
        await expectRevert(assetManager.unstickMinting(proof, args.collateralReservationId, { from: agentOwner1}), "collateral reservation not approved");
    });

    it("should not default minting if minting non-payment proof window too short", async () => {
        // init
        const agentVault = await createAgent(agentOwner1, underlyingAgent1);
        await depositAndMakeAgentAvailable(agentVault, agentOwner1);
        const crt = await reserveCollateral(agentVault.address, 3);
        // mine some blocks to create overflow block
        chain.mine(chainInfo.underlyingBlocksForPayment + 1);
        // skip the time until the proofs cannot be made anymore
        chain.skipTime(Number(settings.attestationWindowSeconds) + 1);
        // act
        // wrong overflow block
        const proofOverflow = await attestationProvider.proveReferencedPaymentNonexistence(
            underlyingAgent1, crt.paymentReference, crt.valueUBA.add(crt.feeUBA),
            crt.firstUnderlyingBlock.toNumber() + 1, crt.lastUnderlyingBlock.toNumber(), crt.lastUnderlyingTimestamp.toNumber());
        const promiseOverflow = assetManager.mintingPaymentDefault(proofOverflow, crt.collateralReservationId, { from: agentOwner1 });
        // assert
        await expectRevert(promiseOverflow, "minting non-payment proof window too short");
    });
});
