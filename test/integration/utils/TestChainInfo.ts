import { ChainInfo } from "../../../lib/fasset/ChainInfo";

export interface TestNatInfo {
    name: string;
    symbol: string;
    startPrice: number;
}

export interface TestChainInfo extends ChainInfo {
    startPrice: number;
    blockTime: number;
    finalizationBlocks: number;
    underlyingBlocksForPayment: number;
    lotSize: number;
}

export const testNatInfo: TestNatInfo = {
    name: "NetworkNative",
    symbol: "NAT",
    startPrice: 1.12,
}

export const testChainInfo: Record<'eth' | 'btc' | 'xrp', TestChainInfo> = {
    eth: {
        chainId: 1,
        name: "Ethereum",
        symbol: "ETH",
        decimals: 18,
        amgDecimals: 9,
        startPrice: 1621.0,
        blockTime: 12,
        finalizationBlocks: 6,
        underlyingBlocksForPayment: 10,
        lotSize: 30,
        requireEOAProof: true,
    },
    btc: {
        chainId: 2,
        name: "Bitcoin",
        symbol: "BTC",
        decimals: 8,
        amgDecimals: 8,
        startPrice: 25213.0,
        blockTime: 600,
        finalizationBlocks: 6,
        underlyingBlocksForPayment: 8,
        lotSize: 2,
        requireEOAProof: false,
    },
    xrp: {
        chainId: 3,
        name: "Ripple",
        symbol: "XRP",
        decimals: 6,
        amgDecimals: 8,
        startPrice: 0.53,
        blockTime: 10,
        finalizationBlocks: 6,
        underlyingBlocksForPayment: 10,
        lotSize: 10_000,
        requireEOAProof: false,
    }
}
