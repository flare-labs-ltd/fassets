import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DiamondSelectors } from "../../lib/utils/diamond";
import { DiamondCutJson, DiamondCutJsonFacet, DiamondCutJsonInit } from "./DiamondCutJson";
import { JsonParameterSchema } from "./JsonParameterSchema";
import { ContractStore } from "./contracts";
import { deployFacet } from "./deploy-asset-manager-facets";
import { ZERO_ADDRESS, abiEncodeCall, loadDeployAccounts, waitFinalize } from "./deploy-utils";
import { contractMetadata } from "../../lib/utils/helpers";

const diamondCutJsonSchema = new JsonParameterSchema<DiamondCutJson>(require('../cuts/diamond-cuts.schema.json'));

export type DiamondCutsOptions = { execute?: boolean, verbose?: boolean };
export type SingleDiamondCuts = DiamondCutJson & { diamond: string };

export async function deployCuts(hre: HardhatRuntimeEnvironment, contracts: ContractStore, cutsJSonFile: string, options: DiamondCutsOptions) {
    const cuts = diamondCutJsonSchema.load(cutsJSonFile);
    const diamondNames = Array.isArray(cuts.diamond) ? cuts.diamond : [cuts.diamond];
    for (const diamondName of diamondNames) {
        const diamondCuts: SingleDiamondCuts = { ...cuts, diamond: diamondName };
        await deployCutsOnDiamond(hre, contracts, diamondCuts, options);
    }
}

export async function deployCutsOnDiamond(hre: HardhatRuntimeEnvironment, contracts: ContractStore, cuts: SingleDiamondCuts, options: DiamondCutsOptions = {}) {
    const artifacts = hre.artifacts as Truffle.Artifacts;
    const { deployer } = loadDeployAccounts(hre);
    const diamondAddress = contracts.getAddress(cuts.diamond);
    //
    const IDiamondLoupe = artifacts.require("IDiamondLoupe");
    const diamondLoupeInstance = await IDiamondLoupe.at(diamondAddress);
    const deployedSelectors = await DiamondSelectors.fromLoupe(diamondLoupeInstance);
    // create cuts
    const newSelectors = await createNewSelectors(hre, contracts, cuts.facets, deployer);
    const diamondCuts = deployedSelectors.createCuts(newSelectors);
    // create init
    const [initAddress, initCalldata] = await createInitCall(hre, contracts, cuts.init);
    // perform or print cuts
    const IDiamondCut = artifacts.require("DiamondCutFacet");
    const diamondCutInstance = await IDiamondCut.at(diamondAddress);
    const productionMode = await diamondCutInstance.productionMode();
    const executeCuts = options.execute && !productionMode;
    if (options.verbose || !executeCuts) {
        console.log(`------------------------------- ${cuts.diamond} ---------------------------------`);
        console.log(`CUTS:`, diamondCuts);
        console.log(`INIT:`, [initAddress, initCalldata]);
        console.log("INIT (decoded):", cuts.init);
    }
    if (executeCuts) {
        await waitFinalize(hre, deployer, () => diamondCutInstance.diamondCut(diamondCuts, initAddress, initCalldata, { from: deployer }));
    } else {
        console.log(`---- Diamond cut not executed. Data for manual execution on ${cuts.diamond}: ----`);
        console.log("ADDRESS:", diamondAddress);
        console.log("CALLDATA:", abiEncodeCall(diamondCutInstance, (inst) => inst.diamondCut(diamondCuts, initAddress, initCalldata)));
        console.log(`---- Decoded call as tuples: ----`);
        const params = contractMetadata(IDiamondCut).abi.find(it => it.name === "diamondCut")!.inputs!;
        console.log(params[0].name, JSON.stringify(resultToTuple(web3.eth.abi.decodeParameter(params[0], web3.eth.abi.encodeParameter(params[0], diamondCuts)))));
        console.log(params[1].name, initAddress);
        console.log(params[2].name, initCalldata);
    }
}

function resultToTuple(value: any): any {
    if (typeof value === "object") {
        if (web3.utils.isBN(value)) {
            return value.ltn(1e9) ? Number(value) : String(value);
        }
        if (Array.isArray(value)) {
            return value.map(resultToTuple);
        }
        // convert object with numeric props to array
        const tuple = [];
        for (let i = 0; i in value; i++) {
            tuple.push(resultToTuple(value[i]));
        }
        return tuple;
    }
    return value;
}

async function createNewSelectors(hre: HardhatRuntimeEnvironment, contracts: ContractStore, facets: DiamondCutJsonFacet[], deployer: string) {
    let selectors = new DiamondSelectors();
    for (const facet of facets) {
        const facetSelectors = await createFacetSelectors(hre, contracts, facet, deployer);
        selectors = selectors.merge(facetSelectors);
    }
    return selectors;
}

async function createFacetSelectors(hre: HardhatRuntimeEnvironment, contracts: ContractStore, facet: DiamondCutJsonFacet, deployer: string) {
    const contract = hre.artifacts.require(facet.contract) as Truffle.Contract<Truffle.ContractInstance>;
    const address = await deployFacet(hre, facet.contract, contracts, deployer);
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
