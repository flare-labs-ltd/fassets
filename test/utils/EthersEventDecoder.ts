import { EventFragment, ParamType } from "@ethersproject/abi";
import { Log as EthersRawEvent, TransactionReceipt as EthersTransactionReceipt } from "@ethersproject/abstract-provider";
import { BigNumber, Contract, ContractReceipt, Event as EthersEvent } from "ethers";
import { isNotNull } from "../../lib/utils/helpers";
import { EventFormatter } from "../../lib/utils/EventFormatter";
import { EvmEvent } from "../../lib/utils/events/common";


export class EthersEventDecoder extends EventFormatter {
    public contracts = new Map<string, Contract>(); // address => instance

    constructor(contracts: { [name: string]: Contract; }) {
        super();
        this.addContracts(contracts);
    }

    addContracts(contracts: { [name: string]: Contract; }) {
        for (const [contractName, contract] of Object.entries(contracts)) {
            this.contractNames.set(contract.address, contractName);
            this.contracts.set(contract.address, contract);
        }
    }

    decodeArg(type: ParamType, value: any) {
        return value;
    }

    decodeEvent(event: EthersRawEvent | EthersEvent): EvmEvent | null {
        const contract = this.contracts.get(event.address);
        if (contract == null)
            return null;
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
        const decodedArgs: any = []; // decodedArgs will be tuple with named properties
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
        };
    }

    decodeEvents(tx: EthersTransactionReceipt | ContractReceipt): EvmEvent[] {
        const events = (tx as ContractReceipt).events ?? tx.logs;
        return events.map(raw => this.decodeEvent(raw)).filter(isNotNull);
    }

    isBigNumber(x: any) {
        return x instanceof BigNumber || super.isBigNumber(x);
    }
}
