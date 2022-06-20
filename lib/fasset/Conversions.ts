import { BNish, toBN, toBNExp } from "../utils/helpers";
import { AssetManagerSettings } from "./AssetManagerTypes";

export const AMG_NATWEI_PRICE_SCALE = toBNExp(1, 9);
export const NAT_WEI = toBNExp(1, 18);

export function lotSize(settings: AssetManagerSettings) {
    return toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
}

export function amgToNATWeiPrice(settings: AssetManagerSettings, natPriceUSDDec5: BNish, assetPriceUSDDec5: BNish) {
    // _natPriceUSDDec5 < 2^128 (in ftso) and assetUnitUBA, are both 64 bit, so there can be no overflow
    return toBN(assetPriceUSDDec5)
        .mul(toBN(settings.assetMintingGranularityUBA).mul(NAT_WEI).mul(AMG_NATWEI_PRICE_SCALE))
        .div(toBN(natPriceUSDDec5).mul(toBN(settings.assetUnitUBA)));
}

export function convertAmgToUBA(settings: AssetManagerSettings, valueAMG: BNish) {
    return toBN(valueAMG).mul(toBN(settings.assetMintingGranularityUBA));
}

export function convertUBAToAmg(settings: AssetManagerSettings, valueUBA: BNish) {
    return toBN(valueUBA).div(toBN(settings.assetMintingGranularityUBA));
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

export function convertAmgToNATWei(valueAMG: BNish, amgToNATWeiPrice: BNish) {
    return toBN(valueAMG).mul(toBN(amgToNATWeiPrice)).div(AMG_NATWEI_PRICE_SCALE);
}

export function convertNATWeiToAMG(valueNATWei: BNish, amgToNATWeiPrice: BNish) {
    return toBN(valueNATWei).mul(AMG_NATWEI_PRICE_SCALE).div(toBN(amgToNATWeiPrice));
}

export function convertUBAToNATWei(settings: AssetManagerSettings, valueUBA: BNish, amgToNATWeiPrice: BNish) {
    return convertAmgToNATWei(convertUBAToAmg(settings, valueUBA), amgToNATWeiPrice);
}
