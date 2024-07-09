import { constants, expectRevert, time } from "@openzeppelin/test-helpers";
import { erc165InterfaceId } from "../../../../lib/utils/helpers";
import { FtsoV2PriceStoreInstance, MockContractInstance } from "../../../../typechain-truffle";
import { getTestFile, loadFixtureCopyVars } from "../../../utils/test-helpers";
import { TestSettingsContracts, createTestContracts } from "../../../utils/test-settings";
import { assertWeb3Equal } from "../../../utils/web3assertions";

const FtsoV2PriceStore = artifacts.require('FtsoV2PriceStore');
const MockContract = artifacts.require('MockContract');

contract(`FtsoV2PriceStore.sol; ${getTestFile(__filename)}; FtsoV2PriceStore basic tests`, async accounts => {
    let contracts: TestSettingsContracts;
    let priceStore: FtsoV2PriceStoreInstance;
    let relayMock: MockContractInstance;
    const governance = accounts[10];
    const votingEpochDurationSeconds = 90;
    const ftsoScalingProtocolId = 100;
    let startTs: number;

    const trustedProviders = [accounts[1], accounts[2], accounts[3]];
    const feedIds = ["0x01464c522f55534400000000000000000000000000", "0x01555344432f555344000000000000000000000000"];
    const feedSymbols = ["FLR", "USDC"];
    const feedDecimals = [6, 5];

    async function initialize() {
        contracts = await createTestContracts(governance);
        startTs = (await time.latest()).toNumber() - votingEpochDurationSeconds;
        priceStore = await FtsoV2PriceStore.new(
            contracts.governanceSettings.address,
            governance,
            contracts.addressUpdater.address,
            startTs,
            votingEpochDurationSeconds,
            ftsoScalingProtocolId
        );
        relayMock = await MockContract.new();
        await priceStore.setTrustedProviders(trustedProviders, 1, { from: governance });
        await priceStore.updateSettings(feedIds, feedSymbols, feedDecimals, { from: governance });
        await contracts.addressUpdater.update(["AddressUpdater", "Relay"],
            [contracts.addressUpdater.address, relayMock.address],
            [priceStore.address],
            { from: governance });
        return { contracts, priceStore };
    }

    beforeEach(async () => {
        ({ contracts, priceStore } = await loadFixtureCopyVars(initialize));
    });

    describe("method tests", () => {

        it("should get price", async () => {
            await publishPrices();

            const { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPrice("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, startTs + 2 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 5);
        });

        it("should get trusted price", async () => {
            await time.increaseTo(startTs + 2 * votingEpochDurationSeconds); // start of voting round 2
            const feeds0 = [];
            const feeds1 = [];
            const feeds2 = [];
            for (let i = 0; i < feedIds.length; i++) {
                feeds0.push({ id: feedIds[i], value: 123458, decimals: feedDecimals[i] });
                feeds1.push({ id: feedIds[i], value: 123455, decimals: feedDecimals[i] });
                feeds2.push({ id: feedIds[i], value: 123456, decimals: feedDecimals[i] });
            }
            const tx1 = await priceStore.submitTrustedPrices(1, feeds0, { from: trustedProviders[0] });
            console.log(`submitTrustedPrices1 gas used: ${tx1.receipt.gasUsed}`);
            const tx2 = await priceStore.submitTrustedPrices(1, feeds1, { from: trustedProviders[1] });
            console.log(`submitTrustedPrices2 gas used: ${tx2.receipt.gasUsed}`);
            const tx3 = await priceStore.submitTrustedPrices(1, feeds2, { from: trustedProviders[2] });
            console.log(`submitTrustedPrices3 gas used: ${tx3.receipt.gasUsed}`);

            await publishPrices();

            const { 0: price, 1: timestamp, 2: decimals } = await priceStore.getPriceFromTrustedProviders("USDC");
            assertWeb3Equal(price, 123456);
            assertWeb3Equal(timestamp, startTs + 2 * votingEpochDurationSeconds);
            assertWeb3Equal(decimals, 5);
        });

        it("should update contract addresses", async () => {
            await contracts.addressUpdater.update(["AddressUpdater", "Relay"],
                [accounts[79], accounts[80]],
                [priceStore.address],
                { from: governance });
            assert.equal(await priceStore.getAddressUpdater(), accounts[79]);
            assert.equal(await priceStore.relay(), accounts[80]);
        });
    });

    describe("ERC-165 interface identification", () => {
        it("should properly respond to supportsInterface", async () => {
            const IERC165 = artifacts.require("@openzeppelin/contracts/utils/introspection/IERC165.sol:IERC165" as 'IERC165');
            const IPriceReader = artifacts.require("IPriceReader");
            const iERC165 = await IERC165.at(priceStore.address);
            const iPriceReader = await IPriceReader.at(priceStore.address);
            assert.isTrue(await priceStore.supportsInterface(erc165InterfaceId(iERC165.abi)));
            assert.isTrue(await priceStore.supportsInterface(erc165InterfaceId(iPriceReader.abi)));
            assert.isFalse(await priceStore.supportsInterface('0xFFFFFFFF'));  // must not support invalid interface
        });
    });

    async function publishPrices() {
        // increase time to the end of reveal time and submission window of voting round 1
        await time.increaseTo(startTs + 2 * votingEpochDurationSeconds + votingEpochDurationSeconds / 2);
        const feed0 = { votingRoundId: 1, id: feedIds[0], value: 123123, turnoutBIPS: 10000, decimals: feedDecimals[0] };
        const feed1 = { votingRoundId: 1, id: feedIds[1], value: 123456, turnoutBIPS: 10000, decimals: feedDecimals[1] };

        const leaf0 = web3.utils.keccak256(web3.eth.abi.encodeParameters(
            ["tuple(uint32,bytes21,int32,uint16,int8)"], // IFtsoFeedPublisher.Feed (uint32 votingRoundId, bytes21 id, int32 value, uint16 turnoutBIPS, int8 decimals)
            [[feed0.votingRoundId, feed0.id, feed0.value, feed0.turnoutBIPS, feed0.decimals]]
        ));

        const leaf1 = web3.utils.keccak256(web3.eth.abi.encodeParameters(
            ["tuple(uint32,bytes21,int32,uint16,int8)"], // IFtsoFeedPublisher.Feed (uint32 votingRoundId, bytes21 id, int32 value, uint16 turnoutBIPS, int8 decimals)
            [[feed1.votingRoundId, feed1.id, feed1.value, feed1.turnoutBIPS, feed1.decimals]]
        ));

        const merkleRoot = web3.utils.keccak256(web3.eth.abi.encodeParameters(
            ["bytes32", "bytes32"],
            leaf0 < leaf1 ? [leaf0 , leaf1] : [leaf1, leaf0]));

        await relayMock.givenCalldataReturn(
            web3.eth.abi.encodeFunctionCall({type: "function", name: "merkleRoots", inputs: [{name: "_protocolId", type: "uint256" }, { name: "_votingRoundId", type: "uint256" }]} as AbiItem, [ftsoScalingProtocolId, 1] as any[]),
            web3.eth.abi.encodeParameter("bytes32", merkleRoot)
        );

        let tx = await priceStore.publishPrices([{ merkleProof: [leaf1], body: feed0 }, { merkleProof: [leaf0], body: feed1 }]);
        console.log(`publishPrices gas used: ${tx.receipt.gasUsed}`);
    }
});
