import { DiamondCutFacetInstance, DiamondLoupeFacetInstance } from "../../typechain-truffle";

export enum FacetCutAction { Add = 0, Replace = 1, Remove = 2 };

export type DiamondCut = Parameters<DiamondCutFacetInstance["diamondCut"]>[0][0];

export type DiamondFacet = Awaited<ReturnType<DiamondLoupeFacetInstance["facets"]>>[0];

export class DiamondSelectors {
    constructor(
        public contract: Truffle.ContractInstance,
        public selectors: string[],
    ) { }

    static fromABI(contract: Truffle.ContractInstance) {
        const functions = contract.abi.filter(abi => abi.type === 'function');
        const initSig = web3.eth.abi.encodeFunctionSignature('init(bytes)');
        const selectors = functions.map(abi => web3.eth.abi.encodeFunctionSignature(abi)).filter(sig => sig !== initSig);
        return new DiamondSelectors(contract, selectors);
    }

    static async fromLoupe(loupe: DiamondLoupeFacetInstance) {
        const selectors: string[] = [];
        const facets = await loupe.facets();
        for (const facet of facets) {
            selectors.push(...facet.functionSelectors);
        }
        return new DiamondSelectors(loupe, selectors);
    }

    restrict(functions: Array<string | AbiItem>) {
        const removeSelectors = new Set(functions.map(abi => web3.eth.abi.encodeFunctionSignature(abi)));
        const selectors = this.selectors.filter(sel => removeSelectors.has(sel));
        return new DiamondSelectors(this.contract, selectors);
    }

    remove(functions: Array<string | AbiItem>) {
        const removeSelectors = new Set(functions.map(abi => web3.eth.abi.encodeFunctionSignature(abi)));
        const selectors = this.selectors.filter(sel => !removeSelectors.has(sel));
        return new DiamondSelectors(this.contract, selectors);
    }
}
