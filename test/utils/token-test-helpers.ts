import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { CallOverrides, Signer } from "ethers";
import { VPContract__factory, VPToken } from "../../typechain";
import { ethersNew } from "./ethers-new";

const VPContractContract = artifacts.require("VPContract");

interface IISetVpContract {
    address: string;
    setReadVpContract(_vpContract: string, txDetails?: Truffle.TransactionDetails): Promise<unknown>;
    setWriteVpContract(_vpContract: string, txDetails?: Truffle.TransactionDetails): Promise<unknown>;
    vpContractInitialized(): Promise<boolean>;
}

export async function setDefaultVPContract(token: IISetVpContract, governance: string) {
    const replacement = await token.vpContractInitialized();
    const vpContract = await VPContractContract.new(token.address, replacement);
    await token.setWriteVpContract(vpContract.address, { from: governance });
    await token.setReadVpContract(vpContract.address, { from: governance });
}

interface IISetVpContract_ethers {
    address: string;
    setReadVpContract(_vpContract: string, overrides?: CallOverrides): Promise<unknown>;
    setWriteVpContract(_vpContract: string, overrides?: CallOverrides): Promise<unknown>;
    vpContractInitialized(): Promise<boolean>;
}

export async function setDefaultVPContract_ethers(token: IISetVpContract_ethers, governance: SignerWithAddress | string) {
    if (typeof governance !== 'string') governance = governance.address;
    const replacement = await token.vpContractInitialized();
    const vpContract = await ethersNew(VPContract__factory, token.address, replacement);
    await token.setWriteVpContract(vpContract.address, { from: governance });
    await token.setReadVpContract(vpContract.address, { from: governance });
}
