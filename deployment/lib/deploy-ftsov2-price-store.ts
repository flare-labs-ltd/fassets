import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { readFileSync } from 'node:fs';
import { FAssetContractStore } from "./contracts";
import { encodeContractNames, loadDeployAccounts, networkConfigName, truffleContractMetadata } from './deploy-utils';

interface FtsoV2PriceStoreParameters {
    contractName: string;
    firstVotingRoundStartTs: number;
    votingEpochDurationSeconds: number;
    trustedProviders: string[];
    trustedProvidersThreshold: number;
    maxSpreadBIPS: number;
    feeds: Array<{
        feedId: string;
        symbol: string;
        feedDecimals: number;
    }>;
}

export async function deployPriceReaderV2(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying PriceReaderV2`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const { deployer } = loadDeployAccounts(hre);
    const parameters = readFtsoV2Parameters(hre);

    const FtsoV2PriceStore = artifacts.require(parameters.contractName as "FtsoV2PriceStore");

    const ftsoV2PriceStore = await FtsoV2PriceStore.new(contracts.GovernanceSettings.address, deployer, deployer, parameters.firstVotingRoundStartTs, parameters.votingEpochDurationSeconds, 100);
    await ftsoV2PriceStore.updateContractAddresses(encodeContractNames(["AddressUpdater", "Relay"]), [contracts.AddressUpdater.address, contracts.Relay.address], { from: deployer });

    await ftsoV2PriceStore.setTrustedProviders(parameters.trustedProviders, parameters.trustedProvidersThreshold, { from: deployer });
    await ftsoV2PriceStore.updateSettings(
        encodeFeedIds(parameters.feeds.map(feed => ({ category: 1, name: feed.feedId }))),
        parameters.feeds.map(feed => feed.symbol),
        parameters.feeds.map(feed => feed.feedDecimals),
        parameters.maxSpreadBIPS,
        { from: deployer });

    contracts.add("PriceReader", "FtsoV2PriceStore.sol", ftsoV2PriceStore.address);
    contracts.add("FtsoV2PriceStore", "FtsoV2PriceStore.sol", ftsoV2PriceStore.address, { mustSwitchToProduction: true });

    console.log(`    deployed ${truffleContractMetadata(FtsoV2PriceStore).contractName}`);
}

export interface IFeedId {
    category: number;
    name: string;
}

export function encodeFeedIds(feedIds: IFeedId[]): string[] {
    const result = [];
    for (const feedId of feedIds) {
        if (feedId.category < 0 || feedId.category >= 2 ** 8) {
            throw Error(`Invalid feed category: ${feedId.category}`);
        }
        if (feedId.name.length > 20) {
            throw Error(`Invalid feed name: ${feedId.name} - length: ${feedId.name.length}`);
        }
        result.push("0x" + feedId.category.toString(16).padStart(2, "0") + Buffer.from(feedId.name).toString("hex").padEnd(40, "0"));
    }
    return result;
}

function readFtsoV2Parameters(hre: HardhatRuntimeEnvironment): FtsoV2PriceStoreParameters {
    const networkConfig = networkConfigName(hre);
    const paramFileName = `deployment/config/${networkConfig}/ftsov2.json`;
    return JSON.parse(readFileSync(paramFileName, { encoding: "ascii" }));
}

export async function verifyFtsoV2PriceStore(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    const parameters = readFtsoV2Parameters(hre);
    const { deployer } = loadDeployAccounts(hre);
    await hre.run("verify:verify", {
        address: contracts.PriceReader!.address,
        constructorArguments: [contracts.GovernanceSettings.address, deployer, deployer, parameters.firstVotingRoundStartTs, parameters.votingEpochDurationSeconds, 100]
    });
}
