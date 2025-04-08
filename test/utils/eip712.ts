import { signTypedMessage, TypedDataUtils, TypedMessage } from "eth-sig-util";
import { fromRpcSig } from "ethereumjs-util";
import Web3 from "web3";
import { IERC5267Instance } from '../../typechain-truffle';

export interface EIP712Domain {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
    salt?: string;
}

export type EIP712DomainType = Array<{
    name: keyof EIP712Domain;
    type: string;
}>;

export const EIP712DomainFields: EIP712DomainType = [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
    { name: 'salt', type: 'bytes32' },
];

export function bufferToHexString(buffer: Buffer) {
    return '0x' + buffer.toString('hex');
}

export function hexStringToBuffer(hexstr: string) {
    return Buffer.from(hexstr.replace(/^0x/, ''), 'hex');
}

export async function getDomain(contract: IERC5267Instance): Promise<EIP712Domain> {
    const { 0: fields, 1: name, 2: version, 3: chainId, 4: verifyingContract, 5: salt, 6: extensions } = await contract.eip712Domain();

    if (extensions.length > 0) {
        throw Error('Extensions not implemented');
    }

    const domain: EIP712Domain = { name, version, chainId: Number(chainId), verifyingContract, salt };
    for (const [i, { name }] of EIP712DomainFields.entries()) {
        if (!(Number(fields) & (1 << i))) {
            delete domain[name];
        }
    }

    return domain;
}

export function domainType(domain: EIP712Domain): EIP712DomainType {
    return EIP712DomainFields.filter(({ name }) => domain[name] !== undefined);
}

export function domainSeparator(domain: EIP712Domain) {
    return bufferToHexString(
        TypedDataUtils.hashStruct('EIP712Domain', domain as any, { EIP712Domain: domainType(domain) }),
    );
}

export function hashTypedData(domain: EIP712Domain, structHash: string) {
    return Web3.utils.keccak256(
        bufferToHexString(Buffer.concat(['0x1901', domainSeparator(domain), structHash].map(str => hexStringToBuffer(str))))
    );
}

export function signTypedMessageData<T extends { EIP712Domain: typeof EIP712DomainFields }>(privateKey: string, data: TypedMessage<T>) {
    const rpcSig = signTypedMessage(hexStringToBuffer(privateKey), { data });
    const { v, r, s } = fromRpcSig(rpcSig);
    return { v, r: bufferToHexString(r), s: bufferToHexString(s) };
}
