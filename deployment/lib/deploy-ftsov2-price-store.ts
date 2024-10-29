import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { FAssetContractStore } from "./contracts";
import { loadDeployAccounts, networkConfigName } from './deploy-utils';

export async function deployPriceReaderV2(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    console.log(`Deploying PriceReaderV2`);

    const artifacts = hre.artifacts as Truffle.Artifacts;

    const { deployer } = loadDeployAccounts(hre);
    const network = networkConfigName(hre);

    const FtsoV2PriceStore = network === 'hardhat' ? artifacts.require("FtsoV2PriceStoreMock") : artifacts.require("FtsoV2PriceStore");

    const firstVotingRoundStartTs = network === 'songbird' || network === 'coston' ? 1658429955 : 1658430000;
    const ftsoV2PriceStore = await FtsoV2PriceStore.new(contracts.GovernanceSettings.address, deployer, deployer, firstVotingRoundStartTs, 90, 100);
    await ftsoV2PriceStore.updateContractAddresses(encodeContractNames(["AddressUpdater", "Relay"]), [contracts.AddressUpdater.address, contracts.Relay.address], { from: deployer });

    await ftsoV2PriceStore.setTrustedProviders(["0xaec76c9b8fa7e13699e7dffbf7abfae5e943f1c1"], 1, { from: deployer });
    await ftsoV2PriceStore.updateSettings(
        encodeFeedIds([
            {category : 1, name: "SGB/USD"},
            {category : 1, name: "BTC/USD"},
            {category : 1, name: "XRP/USD"},
            {category : 1, name: "DOGE/USD"},
            {category : 1, name: "ETH/USD"},
            {category : 1, name: "USDC/USD"},
            {category : 1, name: "USDT/USD"}
        ]),
        ["CFLR", "testBTC", "testXRP", "testDOGE", "testETH", "testUSDC", "testUSDT"],
        [7, 2, 5, 5, 3, 5, 5],
        { from: deployer });

    contracts.add("PriceReader", "FtsoV2PriceStore.sol", ftsoV2PriceStore.address);
    contracts.add("FtsoV2PriceStore", "FtsoV2PriceStore.sol", ftsoV2PriceStore.address, { mustSwitchToProduction: true });

    console.log(`    deployed ${ftsoV2PriceStore.contract.contractName}`);
}

export interface IFeedId {
    category: number;
    name: string;
  }

export function encodeFeedIds(feedIds: IFeedId[]): string[] {
    const result = [];
    for (const feedId of feedIds) {
        if (feedId.category < 0 || feedId.category >= 2**8) {
            throw Error(`Invalid feed category: ${feedId.category}`);
        }
        if (feedId.name.length > 20) {
            throw Error(`Invalid feed name: ${feedId.name} - length: ${feedId.name.length}`);
        }
        result.push("0x" + feedId.category.toString(16).padStart(2, "0") + Buffer.from(feedId.name).toString("hex").padEnd(40, "0"));
    }
    return result;
}

export function encodeContractNames(names: string[]): string[] {
    return names.map(name => encodeString(name));
}

export function encodeString(text: string): string {
    return web3.utils.keccak256(web3.eth.abi.encodeParameters(["string"], [text]));
}

export async function verifyFtsoV2PriceStore(hre: HardhatRuntimeEnvironment, contracts: FAssetContractStore) {
    const network = networkConfigName(hre);
    const { deployer } = loadDeployAccounts(hre);
    await hre.run("verify:verify", {
        address: contracts.PriceReader!.address,
        constructorArguments: [contracts.GovernanceSettings.address, deployer, deployer, network === 'songbird' || network === 'coston' ? 1658429955 : 1658430000, 90, 100]
    });
}
