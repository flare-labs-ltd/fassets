export interface DiamondCutJsonFacet {
    contract: string;
    methods?: string[]; // expose only the methods with given names
    exposedInterfaces?: string[]; // expose only the methods from these interfaces
}
export interface DiamondCutJsonInit {
    contract: string;
    method: string;
    args?: any[];
}

export interface DiamondCutJson {
    diamond: string; // address of diamond or name in contracts.json
    facets: DiamondCutJsonFacet[];
    init?: DiamondCutJsonInit;
}

export type DiamondCutJsonSchema = DiamondCutJson & { $schema?: string };
