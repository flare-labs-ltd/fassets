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
