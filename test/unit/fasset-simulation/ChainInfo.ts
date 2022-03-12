export interface ChainInfo {
    chainId: number;
    name: string;
    symbol: string;
    decimals: number;
    amgDecimals: number;
    startPrice: number;
    blockTime: number;
    underlyingBlocksForPayment: number;
    lotSize: number;
    requireEOAProof: boolean;
}

export const testChainInfo: { [name: string]: ChainInfo } = {
    eth: {
        chainId: 1,
        name: "Ethereum",
        symbol: "ETH",
        decimals: 18,
        amgDecimals: 9,
        startPrice: 3251.0,
        blockTime: 12,
        underlyingBlocksForPayment: 10,
        lotSize: 30,
        requireEOAProof: true,
    },
    btc: {
        chainId: 2,
        name: "Bitcoin",
        symbol: "BTC",
        decimals: 8,
        amgDecimals: 0,
        startPrice: 45213.0,
        blockTime: 600,
        underlyingBlocksForPayment: 8,
        lotSize: 2,
        requireEOAProof: false,
    }
}
