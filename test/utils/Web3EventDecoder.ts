import { isNotNull, toBN } from "../../lib/utils/helpers";
import { EventFormatter } from "../../lib/utils/events/EventFormatter";
import { EventSelector, EvmEvent } from "../../lib/utils/events/common";
import { ContractWithEvents, TruffleExtractEvent } from "../../lib/utils/events/truffle";

export declare type RawEvent = import("web3-core").Log;

export class Web3EventDecoder extends EventFormatter {
    public eventTypes = new Map<string, AbiItem>(); // signature (topic[0]) => type

    constructor(contracts: { [name: string]: Truffle.ContractInstance; }, filter?: string[]) {
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

    decodeEvent(event: RawEvent): EvmEvent | null {
        const signature = event.topics[0];
        const evtType = this.eventTypes.get(signature);
        if (evtType == null)
            return null;
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
            event: evtType.name ?? '<unknown>',
            args: decodedArgs,
            blockHash: event.blockHash,
            blockNumber: event.blockNumber,
            logIndex: event.logIndex,
            transactionHash: event.transactionHash,
            transactionIndex: event.transactionIndex,
        };
    }

    decodeEvents(tx: Truffle.TransactionResponse<any> | TransactionReceipt): EvmEvent[] {
        // for truffle, must decode tx.receipt.rawLogs to also obtain logs from indirectly called contracts
        // for plain web3, just decode receipt.logs
        const receipt: TransactionReceipt = 'receipt' in tx ? tx.receipt : tx;
        const rawLogs: RawEvent[] = 'rawLogs' in receipt ? (receipt as any).rawLogs : receipt.logs;
        // decode all events
        return rawLogs.map(raw => this.decodeEvent(raw)).filter(isNotNull);
    }

    findEvent<E extends EventSelector, N extends E['name']>(response: Truffle.TransactionResponse<E>, name: N): TruffleExtractEvent<E, N> | undefined {
        const logs = this.decodeEvents(response);
        return logs.find(e => e.event === name) as any;
    }

    findEventFrom<C extends Truffle.ContractInstance, E extends EventSelector, N extends E['name']>(response: Truffle.TransactionResponse<any>, contract: ContractWithEvents<C, E>, eventName: N): TruffleExtractEvent<E, N> | undefined {
        const logs = this.decodeEvents(response);
        if (!this.contractNames.has(contract.address)) throw new Error(`Contract at ${contract.address} not registered`);
        return logs.find(e => e.address === contract.address && e.event === eventName) as any;
    }
}

export function findRequiredEventFrom<C extends Truffle.ContractInstance, E extends EventSelector, N extends E['name']>(response: Truffle.TransactionResponse<any>, contract: ContractWithEvents<C, E>, name: N): TruffleExtractEvent<E, N> {
    const eventDecoder = new Web3EventDecoder({ contract });
    const event = eventDecoder.findEventFrom(response, contract, name);
    if (event == null) {
        throw new Error(`Missing event ${name}`);
    }
    return event;
}

export function requiredEventArgsFrom<C extends Truffle.ContractInstance, E extends EventSelector, N extends E['name']>(response: Truffle.TransactionResponse<any>, contract: ContractWithEvents<C, E>, name: N): TruffleExtractEvent<E, N>['args'] {
    return findRequiredEventFrom(response, contract, name).args;
}
