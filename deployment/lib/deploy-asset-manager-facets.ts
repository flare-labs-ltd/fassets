import { Artifact, HardhatRuntimeEnvironment } from 'hardhat/types';
import { DiamondCut, FacetCutAction } from "../../test/utils/diamond";
import { ContractStore } from "./contracts";
import { deployedCodeMatches } from './deploy-utils';

const assetManagerInterfaces = [
    'IIAssetManager'
];

const assetManagerInitContract = 'AssetManagerInit';

const assetManagerFacets = [
    'DiamondCutFacet',
    'DiamondLoupeFacet',
    'AgentInfoFacet',
    'AvailableAgentsFacet',
    'MintingFacet',
    'RedemptionRequestsFacet',
    'RedemptionConfirmationsFacet',
    'RedemptionDefaultsFacet',
    'LiquidationFacet',
    'ChallengesFacet',
    'UnderlyingBalanceFacet',
    'UnderlyingTimekeepingFacet',
    'AgentVaultManagementFacet',
    'AgentSettingsFacet',
    'CollateralTypesFacet',
    'AgentCollateralFacet',
    'SettingsReaderFacet',
    'SettingsManagementFacet',
    'AgentVaultAndPoolSupportFacet',
    'SystemStateManagementFacet',
];

export async function deployAllAssetManagerFacets(hre: HardhatRuntimeEnvironment, contracts: ContractStore) {
    for (const facetName of assetManagerFacets) {
        await deployFacet(hre, facetName, contracts);
    }
}

// deploy facet unless it is already dpeloyed with identical code (facets must be stateless)
export async function deployFacet(hre: HardhatRuntimeEnvironment, facetName: string, contracts: ContractStore) {
    const artifact = hre.artifacts.readArtifactSync(facetName);
    const alreadyDeployed = await deployedCodeMatches(artifact, contracts.get(facetName)?.address);
    if (!alreadyDeployed) {
        const contractFactory = hre.artifacts.require(facetName);
        const instance = await contractFactory.new() as Truffle.ContractInstance;
        contracts.add(facetName, `${facetName}.sol`, instance.address);
        console.log(`Deployed facet ${facetName}`);
        return instance.address;
    } else {
        return contracts.getRequired(facetName).address;
    }
}

export async function createDiamondCutsForAllAssetManagerFacets(hre: HardhatRuntimeEnvironment, contracts: ContractStore) {
    const interfaceAbis = assetManagerInterfaces.map(name => hre.artifacts.readArtifactSync(name).abi as AbiItem[]);
    const interfaceSelectorMap = methodSelectorMap(...interfaceAbis);
    const interfaceSelectors = new Set(interfaceSelectorMap.keys());
    const diamondCuts: DiamondCut[] = [];
    for (const facetName of assetManagerFacets) {
        const facetAddress = contracts.getRequired(facetName).address;
        const artifact = hre.artifacts.readArtifactSync(facetName);
        diamondCuts.push(await createDiamondCut(artifact, facetAddress, interfaceSelectors));
    }
    // verify every required selector is included in some cut
    for (const cut of diamondCuts) {
        for (const selector of cut.functionSelectors) {
            interfaceSelectors.delete(selector);
        }
    }
    if (interfaceSelectors.size > 0) {
        const missing = Array.from(interfaceSelectors).map(sel => interfaceSelectorMap.get(sel)?.name);
        throw new Error(`Deployed facets are missing methods ${missing.join(", ")}`);
    }
    return diamondCuts;
}

export async function createDiamondCut(artifact: Artifact, address: string, selectorFilter: Set<string>): Promise<DiamondCut> {
    const instanceSelectors = artifact.abi.map(it => web3.eth.abi.encodeFunctionSignature(it));
    const exposedSelectors = instanceSelectors.filter(sel => selectorFilter.has(sel));
    if (exposedSelectors.length === 0) {
        throw new Error(`No exposed methods in ${artifact.contractName}`);
    }
    return {
        action: FacetCutAction.Add,
        facetAddress: address,
        functionSelectors: [...exposedSelectors]
    };
}

function methodSelectorMap(...abis: AbiItem[][]) {
    return new Map(abis.flat(1)
        .filter(it => it.type === 'function')
        .map(it => [web3.eth.abi.encodeFunctionSignature(it), it]));
}
