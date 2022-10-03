import { readFileSync, writeFileSync } from "fs";

export interface Contract {
    name: string;
    contractName: string;
    address: string;
}

export interface ChainContracts {
    // flare smart contract
    GovernanceSettings: Contract;
    AddressUpdater: Contract;
    StateConnector: Contract;
    WNat: Contract;
    FtsoRegistry: Contract;
    FtsoManager: Contract;
    // fasset
    AttestationClient?: Contract;
    AgentVaultFactory?: Contract;
    AssetManagerController?: Contract;
    AssetManagerWhitelist?: Contract;
    // others (asset managers & fassets & everything from flare-smart-contract)
    [key: string]: Contract | undefined;
}

export function newContract(name: string, contractName: string, address: string) {
    return { name, contractName, address };
}

export function loadContracts(filename: string): ChainContracts {
    const result: any = {};
    const contractsList: Contract[] = JSON.parse(readFileSync(filename).toString());
    for (const contract of contractsList) {
        result[contract.name] = contract;
    }
    return result as ChainContracts;
}

export function saveContracts(filename: string, contracts: ChainContracts) {
    const contractList: Contract[] = [];
    for (const contract of Object.values(contracts)) {
        if (contract) contractList.push(contract);
    }
    writeFileSync(filename, JSON.stringify(contractList, null, 2));
}
