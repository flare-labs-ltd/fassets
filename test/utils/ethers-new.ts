import { Signer } from "@ethersproject/abstract-signer";
import { BaseContract, Contract, ContractFactory } from "ethers";
import { ethers } from "hardhat";

interface TypedContractFactory<P extends any[], C extends Contract> extends ContractFactory {
    deploy(...args: P): Promise<C>;
}

interface TypedContractFactoryConstructor<P extends any[], C extends Contract> {
    new(signer?: Signer): TypedContractFactory<P, C>;
}

interface TypedContract extends BaseContract {
    connect(signer: Signer): this;
    attach(addressOrName: string): this;
    deployed(): Promise<this>;
}

export function ethersNew<P extends any[], C extends TypedContract>(factoryClass: TypedContractFactoryConstructor<P, C>, ...args: P): Promise<C> {
    return ethersNewFrom(factoryClass, ethers.provider.getSigner(), ...args);
}

export async function ethersNewFrom<P extends any[], C extends TypedContract>(factoryClass: TypedContractFactoryConstructor<P, C>, signer: Signer, ...args: P): Promise<C> {
    const factory = new factoryClass(signer);
    const contract = await factory.deploy(...args);
    return await contract.deployed();
}
