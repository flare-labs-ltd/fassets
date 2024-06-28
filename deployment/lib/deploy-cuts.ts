import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DiamondSelectors } from "../../lib/utils/diamond";
import { DiamondCutJson, DiamondCutJsonFacet, DiamondCutJsonInit } from "./DiamondCutJson";
import { JsonParameterSchema } from "./JsonParameterSchema";
import { ContractStore } from "./contracts";
import { deployFacet } from "./deploy-asset-manager-facets";
import { ZERO_ADDRESS, abiEncodeCall, loadDeployAccounts } from "./deploy-utils";

const diamondCutJsonSchema = new JsonParameterSchema<DiamondCutJson>(require('../cuts/diamond-cuts.schema.json'));

export async function deployCuts(hre: HardhatRuntimeEnvironment, contracts: ContractStore, cutsJSonFile: string, execute: boolean) {
    const cuts = diamondCutJsonSchema.load(cutsJSonFile);
    const diamondNames = Array.isArray(cuts.diamond) ? cuts.diamond : [cuts.diamond];
    for (const diamondName of diamondNames) {
        await deployCutsOnSingleDiamond(hre, contracts, diamondName, cuts, execute);
    }
}

async function deployCutsOnSingleDiamond(hre: HardhatRuntimeEnvironment, contracts: ContractStore, diamondName: string, cuts: DiamondCutJson, execute: boolean) {
    const artifacts = hre.artifacts as Truffle.Artifacts;
    const diamondAddress = contracts.getAddress(diamondName);
    const IDiamondLoupe = artifacts.require("IDiamondLoupe");
    const diamondLoupeInstance = await IDiamondLoupe.at(diamondAddress);
    const deployedSelectors = await DiamondSelectors.fromLoupe(diamondLoupeInstance);
    const newSelectors = await createNewSelectors(hre, contracts, cuts);
    const diamondCuts = deployedSelectors.createCuts(newSelectors);
    console.log(`------------------------------- ${diamondName} ---------------------------------`);
    console.log(`CUTS:`, diamondCuts);
    const [initAddress, initCalldata] = await createInitCall(hre, contracts, cuts.init);
    console.log(`INIT:`, [initAddress, initCalldata]);
    console.log("INIT (decoded):", cuts.init);
    const IDiamondCut = artifacts.require("DiamondCutFacet");
    const diamondCutInstance = await IDiamondCut.at(diamondAddress);
    const productionMode = await diamondCutInstance.productionMode();
    if (execute && !productionMode) {
        const { deployer } = loadDeployAccounts(hre);
        await diamondCutInstance.diamondCut(diamondCuts, initAddress, initCalldata, { from: deployer });
    } else {
        console.log(`---- Diamond cut not executed. Data for manual execution on ${diamondName}: ----`);
        console.log("ADDRESS:", diamondAddress);
        console.log("CALLDATA:", abiEncodeCall(diamondCutInstance, (inst) => inst.diamondCut(diamondCuts, initAddress, initCalldata)));
    }
}

async function createNewSelectors(hre: HardhatRuntimeEnvironment, contracts: ContractStore, cuts: DiamondCutJson) {
    let selectors = new DiamondSelectors();
    for (const facet of cuts.facets) {
        const facetSelectors = await createFacetSelectors(hre, contracts, facet);
        selectors = selectors.merge(facetSelectors);
    }
    return selectors;
}

async function createFacetSelectors(hre: HardhatRuntimeEnvironment, contracts: ContractStore, facet: DiamondCutJsonFacet) {
    const contract = hre.artifacts.require(facet.contract) as Truffle.Contract<Truffle.ContractInstance>;
    const address = await deployFacet(hre, facet.contract, contracts);
    const instance = await contract.at(address);
    const methodFilter = facet.methods && ((abi: AbiItem) => facet.methods!.includes(abi.name!));
    let facetSelectors = DiamondSelectors.fromABI(instance, methodFilter);
    if (facet.exposedInterfaces) {
        let filterSelectors = new DiamondSelectors();
        for (const name of facet.exposedInterfaces) {
            const abi = hre.artifacts.readArtifactSync(name).abi as AbiItem[];
            filterSelectors = filterSelectors.merge(DiamondSelectors.fromABI({ address: ZERO_ADDRESS, abi })); // address doesn't matter for restrict
        }
        facetSelectors = facetSelectors.restrict(filterSelectors);
    }
    return facetSelectors;
}

async function createInitCall(hre: HardhatRuntimeEnvironment, contracts: ContractStore, init?: DiamondCutJsonInit) {
    if (!init) return [ZERO_ADDRESS, "0x00000000"];
    const contract = hre.artifacts.require(init.contract) as Truffle.Contract<Truffle.ContractInstance>;
    const address = contracts.getAddress(init.contract);
    const instance = await contract.at(address);
    const args = init.args ?? [];
    const encodedCall = await instance.contract.methods[init.method](...args).encodeABI() as string;
    return [address, encodedCall] as const;
}
