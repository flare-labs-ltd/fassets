import { existsSync, readFileSync, writeFileSync } from "fs";

export interface Contract {
    name: string;
    contractName: string;
    address: string;
    mustSwitchToProduction?: boolean;
}

export interface FAssetContracts {
    // flare smart contract
    GovernanceSettings: Contract;
    AddressUpdater: Contract;
    StateConnector: Contract;
    WNat: Contract;
    FtsoRegistry: Contract;
    FtsoManager: Contract;
    // fasset
    SCProofVerifier?: Contract;
    AgentVaultFactory?: Contract;
    CollateralPoolFactory?: Contract;
    CollateralPoolTokenFactory?: Contract;
    AssetManagerController?: Contract;
    PriceReader?: Contract;
    UserWhitelist?: Contract;
    AgentOwnerRegistry?: Contract;
}

export type NewContractOptions = Omit<Contract, 'name' | 'contractName' | 'address'>;

export class ContractStore {
    protected readonly map: Map<string, Contract>;

    constructor(
        public readonly filename: string,
        public autosave: boolean,
    ) {
        const list: Contract[] = existsSync(filename) ? JSON.parse(readFileSync(filename).toString()) : [];
        this.map = new Map(list.map(it => [it.name, it]));
    }

    public get(name: string) {
        return this.map.get(name);
    }

    public getRequired(name: string) {
        const value = this.map.get(name);
        if (!value) throw new Error(`Missing contract ${name}`);
        return value;
    }

    public getAddress(addressOrName: string) {
        if (addressOrName.startsWith('0x')) return addressOrName;
        return this.getRequired(addressOrName).address;
    }

    public add(name: string, contractName: string, address: string, options?: NewContractOptions) {
        this.addContract({ name, contractName, address, ...(options ?? {}) });
    }

    public addContract(contract: Contract) {
        this.map.set(contract.name, contract);
        if (this.autosave) {
            this.save();
        }
    }

    public list() {
        return Array.from(this.map.values());
    }

    public save() {
        writeFileSync(this.filename, JSON.stringify(this.list(), null, 2));
    }
}

export class FAssetContractStore extends ContractStore implements FAssetContracts {
    // flare smart contract
    get GovernanceSettings() { return this.getRequired('GovernanceSettings'); }
    get AddressUpdater() { return this.getRequired('AddressUpdater'); }
    get StateConnector() { return this.getRequired('StateConnector'); }
    get WNat() { return this.getRequired('WNat'); }
    get FtsoRegistry() { return this.getRequired('FtsoRegistry'); }
    get FtsoManager() { return this.getRequired('FtsoManager'); }
    // fasset
    get SCProofVerifier() { return this.get('SCProofVerifier'); }
    get AgentVaultFactory() { return this.get('AgentVaultFactory'); }
    get CollateralPoolFactory() { return this.get('CollateralPoolFactory'); }
    get CollateralPoolTokenFactory() { return this.get('CollateralPoolTokenFactory'); }
    get AssetManagerController() { return this.get('AssetManagerController'); }
    get PriceReader() { return this.get('PriceReader'); }
    get UserWhitelist() { return this.get('UserWhitelist'); }
    get AgentOwnerRegistry() { return this.get('AgentOwnerRegistry'); }
}

export function loadContractsList(filename: string): Contract[] {
    return JSON.parse(readFileSync(filename).toString());
}

export function saveContractsList(filename: string, contractList: Contract[]) {
    writeFileSync(filename, JSON.stringify(contractList, null, 2));
}
