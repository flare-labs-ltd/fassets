import { BNish, toBN } from "../helpers";

export namespace PaymentReference {
    export const TYPE_SHIFT = 192;
    
    export const MINTING = toBN('0x7958d5b6aa3dfe33').shln(TYPE_SHIFT);
    export const REDEMPTION = toBN('0x2e700e07b6642eaa').shln(TYPE_SHIFT);
    export const TOPUP = toBN('0xd52a7a170c97df29').shln(TYPE_SHIFT);
    export const SELF_MINT = toBN('0x7825d1a0b3e07380').shln(TYPE_SHIFT);
    export const ANNOUNCED_WITHDRAWAL = toBN('0x238df6e106ee985a').shln(TYPE_SHIFT);
    export const ADDRESS_OWNERSHIP = toBN('0x7bd3bf51c3e904c3').shln(TYPE_SHIFT);
    
    export function minting(id: BNish) {
        return toBN(id).or(MINTING);
    }

    export function redemption(id: BNish) {
        return toBN(id).or(REDEMPTION);
    }
    
    export function announcedWithdrawal(id: BNish) {
        return toBN(id).or(ANNOUNCED_WITHDRAWAL);
    }

    export function addressTopup(address: string) {
        return toBN(address).or(TOPUP);
    }

    export function selfMint(address: string) {
        return toBN(address).or(SELF_MINT);
    }
    
    export function addressOwnership(address: string) {
        return toBN(address).or(ADDRESS_OWNERSHIP);
    }
}
