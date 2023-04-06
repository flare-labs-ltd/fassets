import { BNish, toBN, toBNExp } from "../utils/helpers";
import { AssetManagerSettings } from "./AssetManagerTypes";

export const AMG_TOKENWEI_PRICE_SCALE = toBNExp(1, 9);
export const NAT_WEI = toBNExp(1, 18);

// AMG conversions

export interface AMGSettings {
    assetMintingDecimals: BNish;
    assetMintingGranularityUBA: BNish;
}

export function amgToTokenWeiPrice(settings: AMGSettings, tokenDecimals: BNish, tokenUSD: BNish, tokenFtsoDecimals: BNish, assetUSD: BNish, assetFtsoDecimals: BNish) {
    const ten = toBN(10);
    // the scale by which token/asset price is divided
    const tokenScale = ten.pow(toBN(tokenDecimals).add(toBN(tokenFtsoDecimals)));
    const assetScale = ten.pow(toBN(settings.assetMintingDecimals).add(toBN(assetFtsoDecimals)));
    return toBN(assetUSD).mul(tokenScale).mul(AMG_TOKENWEI_PRICE_SCALE)
        .div(toBN(tokenUSD).mul(assetScale));
}

export function convertAmgToUBA(settings: AMGSettings, valueAMG: BNish) {
    return toBN(valueAMG).mul(toBN(settings.assetMintingGranularityUBA));
}

export function convertUBAToAmg(settings: AMGSettings, valueUBA: BNish) {
    return toBN(valueUBA).div(toBN(settings.assetMintingGranularityUBA));
}

export function convertAmgToTokenWei(valueAMG: BNish, amgToTokenWeiPrice: BNish) {
    return toBN(valueAMG).mul(toBN(amgToTokenWeiPrice)).div(AMG_TOKENWEI_PRICE_SCALE);
}

export function convertTokenWeiToAMG(valueNATWei: BNish, amgToTokenWeiPrice: BNish) {
    return toBN(valueNATWei).mul(AMG_TOKENWEI_PRICE_SCALE).div(toBN(amgToTokenWeiPrice));
}

export function convertUBAToTokenWei(settings: AMGSettings, valueUBA: BNish, amgToNATWeiPrice: BNish) {
    return convertAmgToTokenWei(convertUBAToAmg(settings, valueUBA), amgToNATWeiPrice);
}

export function convertTokenWeiToUBA(settings: AMGSettings, valueWei: BNish, amgToNATWeiPrice: BNish) {
    return convertAmgToUBA(settings, convertTokenWeiToAMG(valueWei, amgToNATWeiPrice));
}

// Lot conversions

export function lotSize(settings: AssetManagerSettings) {
    return toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
}

export function convertUBAToLots(settings: AssetManagerSettings, valueUBA: BNish) {
    return toBN(valueUBA).div(lotSize(settings));
}

export function convertLotsToUBA(settings: AssetManagerSettings, lots: BNish) {
    return toBN(lots).mul(lotSize(settings));
}

export function convertLotsToAMG(settings: AssetManagerSettings, lots: BNish) {
    return toBN(lots).mul(toBN(settings.lotSizeAMG));
}

export function convertAMGToLots(settings: AssetManagerSettings, valueAMG: BNish) {
    return toBN(valueAMG).div(toBN(settings.lotSizeAMG));
}
