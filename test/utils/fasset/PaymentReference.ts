import { BNish, toBN } from "../helpers";

export namespace PaymentReference {
    export const TYPE_SHIFT = 192;
    
    export const MINTING = toBN('0x6641737365740001').shln(TYPE_SHIFT);
    export const REDEMPTION = toBN('0x6641737365740002').shln(TYPE_SHIFT);
    export const ANNOUNCED_WITHDRAWAL = toBN('0x6641737365740003').shln(TYPE_SHIFT);
    export const TOPUP = toBN('0x6641737365740011').shln(TYPE_SHIFT);
    export const SELF_MINT = toBN('0x6641737365740012').shln(TYPE_SHIFT);
    export const ADDRESS_OWNERSHIP = toBN('0x6641737365740013').shln(TYPE_SHIFT);
    
    export function minting(id: BNish) {
        return toBN(id).or(MINTING);
    }

    export function redemption(id: BNish) {
        return toBN(id).or(REDEMPTION);
    }
    
    export function announcedWithdrawal(id: BNish) {
        return toBN(id).or(ANNOUNCED_WITHDRAWAL);
    }

    export function topup(address: string) {
        return toBN(address).or(TOPUP);
    }

    export function selfMint(address: string) {
        return toBN(address).or(SELF_MINT);
    }
    
    export function addressOwnership(address: string) {
        return toBN(address).or(ADDRESS_OWNERSHIP);
    }
}
