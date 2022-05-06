import { EventFragment, ParamType } from "@ethersproject/abi";
import { Log as EthersRawEvent, TransactionReceipt as EthersTransactionReceipt } from "@ethersproject/abstract-provider";
import BN from "bn.js";
import { BigNumber, Contract, ContractReceipt, Event as EthersEvent } from "ethers";
import { BaseEvent, TruffleEvent } from "./events";
import { formatBN, isNotNull, toBN } from "./helpers";

declare type RawEvent = import("web3-core").Log;

function isBigNumber(x: any): x is BigNumber | BN {
    return BN.isBN(x) || x instanceof BigNumber;
}

export class EventFormatter {
    public formatArgsWithNames: boolean = true;
    public contractNames = new Map<string, string>();   // address => name

    addAddress(name: string, address: string) {
        this.contractNames.set(address, name);
    }

    addAddresses(addressMap: { [name: string]: string }) {
        for (const [name, address] of Object.entries(addressMap)) {
            this.contractNames.set(address, name);
        }
    }

    isAddress(s: any): s is string {
        return typeof s === 'string' && /^0x[0-9a-fA-F]{40}/.test(s);
    }

    formatAddress(address: string) {
        return this.contractNames.get(address) ?? address.slice(0, 10) + '...';
    }

    formatArg(value: unknown): string {
        if (isBigNumber(value)) {
            return formatBN(value);
        } else if (this.isAddress(value)) {
            return this.formatAddress(value);
        } else if (Array.isArray(value)) {
            return `[${value.map(v => this.formatArg(v)).join(', ')}]`;
        } else if (typeof value === 'object' && value?.constructor === Object) {
            return `{ ${Object.entries(value).map(([k, v]) => `${k}: ${this.formatArg(v)}`).join(', ')} }`;
        } else {
            return '' + value;
        }
    }

    formatArgs(event: BaseEvent) {
        const result: any = {};
        for (const [key, value] of Object.entries(event.args)) {
            result[key] = this.formatArg(value);
        }
        return result;
    }

    format(event: BaseEvent) {
        const contractName = this.formatAddress(event.address);
        const formattedArgs = this.formatArgs(event);
        if (this.formatArgsWithNames) {
            return EventFormatter.formatEventByNames(event, contractName, formattedArgs);
        } else {
            return EventFormatter.formatEvent(event, contractName, formattedArgs);
        }
    }

    static formatEvent(event: BaseEvent, contractName?: string, args: any = event.args) {
        const keys = Object.keys(args).filter(k => /^\d+$/.test(k)).map(k => Number(k));
        keys.sort((a, b) => a - b);
        const formattedArgs = keys.map(k => args[k]).map(x => web3.utils.isBN(x) ? x.toString() : x);
        return `${contractName ?? event.address}.${event.event}(${formattedArgs.join(', ')})`;
    }

    static formatEventByNames(event: BaseEvent, contractName?: string, args: any = event.args) {
        const keys = Object.keys(args).filter(k => !/^\d+$/.test(k) && k !== '__length__');
        const formattedArgs = keys.map(k => args[k]).map(x => web3.utils.isBN(x) ? x.toString() : x);
        const parts = keys.map((k, i) => `${k}: ${formattedArgs[i]}`);
        return `${contractName ?? event.address}.${event.event}(${parts.join(', ')})`;
    }
}

export class Web3EventDecoder extends EventFormatter {
    public eventTypes = new Map<string, AbiItem>();     // signature (topic[0]) => type

    constructor(contracts: { [name: string]: Truffle.ContractInstance }, filter?: string[]) {
        super();
        this.addContracts(contracts, filter);
    }

    addContracts(contracts: { [name: string]: Truffle.ContractInstance; }, filter?: string[]) {
        for (const contractName of Object.keys(contracts)) {
            const contract = contracts[contractName];
            this.contractNames.set(contract.address, contractName);
            for (const item of contract.abi) {
                if (item.type === 'event' && (filter == null || filter.includes(item.name!))) {
                    this.eventTypes.set((item as any).signature, item);
                }
            }
        }
    }

    decodeEvent(event: RawEvent): TruffleEvent | null {
        const signature = event.topics[0];
        const evtType = this.eventTypes.get(signature);
        if (evtType == null) return null;
        // based on web3 docs, first topic has to be removed for non-anonymous events
        const topics = evtType.anonymous ? event.topics : event.topics.slice(1);
        const decodedArgs: any = web3.eth.abi.decodeLog(evtType.inputs!, event.data, topics);
        // convert parameters based on type (BN for now)
        evtType.inputs!.forEach((arg, i) => {
            if (/^u?int\d*$/.test(arg.type)) {
                decodedArgs[i] = decodedArgs[arg.name] = toBN(decodedArgs[i]);
            } else if (/^u?int\d*\[\]$/.test(arg.type)) {
                decodedArgs[i] = decodedArgs[arg.name] = decodedArgs[i].map(toBN);
            }
        });
        return {
            address: event.address,
            type: evtType.type,
            signature: signature,
            event: evtType.name,
            args: decodedArgs,
            blockHash: event.blockHash,
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            transactionHash: event.transactionHash,
            transactionIndex: event.transactionIndex,
        }
    }

    decodeEvents(tx: Truffle.TransactionResponse<any> | TransactionReceipt): TruffleEvent[] {
        // for truffle, must decode tx.receipt.rawLogs to also obtain logs from indirectly called contracts
        // for plain web3, just decode receipt.logs
        const receipt: TransactionReceipt = 'receipt' in tx ? tx.receipt : tx;
        const rawLogs: RawEvent[] = 'rawLogs' in receipt ? (receipt as any).rawLogs : receipt.logs;
        // decode all events
        return rawLogs.map(raw => this.decodeEvent(raw)).filter(isNotNull);
    }
}

export class EthersEventDecoder extends EventFormatter {
    public contracts = new Map<string, Contract>();     // address => instance

    constructor(contracts: { [name: string]: Contract }) {
        super();
        this.addContracts(contracts);
    }

    addContracts(contracts: { [name: string]: Contract }) {
        for (const [contractName, contract] of Object.entries(contracts)) {
            this.contractNames.set(contract.address, contractName);
            this.contracts.set(contract.address, contract);
        }
    }

    decodeArg(type: ParamType, value: any) {
        return value;
    }

    decodeEvent(event: EthersRawEvent | EthersEvent): TruffleEvent | null {
        const contract = this.contracts.get(event.address);
        if (contract == null) return null;
        let eventName: string;
        let fragment: EventFragment;
        let args: any;
        if ('args' in event && event.args && event.event && event.eventSignature) {
            eventName = event.event;
            fragment = contract.interface.events[event.eventSignature];
            args = event.args;
        } else {
            const decoded = contract.interface.parseLog(event);
            eventName = decoded.name;
            fragment = decoded.eventFragment;
            args = decoded.args;
        }
        const decodedArgs: any = [];  // decodedArgs will be tuple with named properties
        fragment.inputs.forEach((type, i) => {
            decodedArgs[i] = decodedArgs[type.name] = args[i];
        });
        return {
            address: event.address,
            type: 'event',
            signature: event.topics[0],
            event: eventName,
            args: decodedArgs,
            blockHash: event.blockHash,
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            transactionHash: event.transactionHash,
            transactionIndex: event.transactionIndex,
        }
    }

    decodeEvents(tx: EthersTransactionReceipt | ContractReceipt): TruffleEvent[] {
        const events = (tx as ContractReceipt).events ?? tx.logs;
        return events.map(raw => this.decodeEvent(raw)).filter(isNotNull);
    }
}
