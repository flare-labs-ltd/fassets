import { IERC5267Instance } from "../../typechain-truffle";
import { domainType, getDomain, signTypedMessageData } from "./eip712";

export interface Permit {
    owner: string;
    spender: string;
    value: BN;
    nonce: BN;
    deadline: BN;
}

export const PermitFields: Array<{ name: keyof Permit, type: string }> = [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
];

export async function buildPermitData(contract: IERC5267Instance, permit: Permit) {
    const domain = await getDomain(contract);
    return {
        primaryType: 'Permit' as const,
        types: { EIP712Domain: domainType(domain), Permit: PermitFields },
        domain,
        message: permit as any,
    };
}

export async function signPermit(contract: IERC5267Instance, privateKey: string, permit: Permit) {
    const data = await buildPermitData(contract, permit);
    return signTypedMessageData(privateKey, data);
}
