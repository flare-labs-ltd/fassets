export interface ChainInfo {
    chainId: string;
    name: string;
    symbol: string;
    assetName: string;
    assetSymbol: string;
    decimals: number;
    amgDecimals: number;
    requireEOAProof: boolean;
}
