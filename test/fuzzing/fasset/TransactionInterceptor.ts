import { TransactionReceipt } from "web3-core";
import { Web3EventDecoder } from "../../utils/EventDecoder";
import { BaseEvent } from "../../utils/events";
import { currentRealTime, Statistics, stringifyJson, truffleResultAsDict } from "../../utils/fuzzing-utils";
import { filterStackTrace, getOrCreate, reportError, tryCatch } from "../../utils/helpers";
import { LogFile } from "../../utils/LogFile";

export type EventHandler = (event: BaseEvent) => void;

export class TransactionInterceptor {
    logFile?: LogFile;
    eventHandlers: Map<string, EventHandler> = new Map();
    gasUsage: Map<string, Statistics> = new Map();
    errorCounts: Map<String, number> = new Map();
    eventCounts: Map<String, number> = new Map();
    unexpectedErrorCount: number = 0;

    openLog(path: string) {
        this.logFile = new LogFile(path);
    }

    closeLog() {
        if (this.logFile) {
            this.logFile.close();
            this.logFile = undefined;
        }
    }

    log(text: string) {
        if (this.logFile) {
            this.logFile.log(text);
        }
    }

    logUnexpectedError(e: any, prefix = '    !!! UNEXPECTED') {
        reportError(e);
        const indent = prefix.match(/^\s*/)?.[0] ?? '';
        this.log(`${prefix} ${filterStackTrace(e).replace(/\n/g, '\n' + indent)}`);
        this.unexpectedErrorCount += 1;
    }

    comment(comment: string) {
        console.log(comment);
        this.log('****** ' + comment);
    }

    logGasUsage() {
        if (!this.logFile) return;
        const methods = Array.from(this.gasUsage.keys());
        methods.sort();
        this.log('');
        this.log(`ERRORS: ${Array.from(this.errorCounts.values()).reduce((x, y) => x + y, 0)}`);
        for (const [key, count] of this.errorCounts.entries()) {
            this.log(`${key}: ${count}`);
        }
        this.log('');
        this.log(`EVENTS: ${Array.from(this.eventCounts.values()).reduce((x, y) => x + y, 0)}`);
        for (const [key, count] of this.eventCounts.entries()) {
            this.log(`${key}: ${count}`);
        }
        this.log('');
        this.log('GAS USAGE');
        for (const method of methods) {
            this.log(`${method}:   ${this.gasUsage.get(method)?.toString(0)}`);
        }
    }

    increaseErrorCount(error: any) {
        const errorKey = (error + '').replace(/^.*:\s*revert\s*/, '').trim();
        this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) ?? 0) + 1);
    }

    increaseEventCount(event: BaseEvent) {
        this.eventCounts.set(event.event, (this.eventCounts.get(event.event) ?? 0) + 1);
    }
    
    collectEvents(handlerName: string = 'EventCollector') {
        return new EventCollector(this, handlerName);
    }
}

export class EventCollector {
    public events: BaseEvent[] = [];
    
    constructor(
        interceptor: TransactionInterceptor,
        handlerName: string = 'EventCollector',
    ) {
        interceptor.eventHandlers.set(handlerName, (event) => {
            this.events.push(event);
        });
    }
    
    popCollectedEvents() {
        const events = this.events;
        this.events = [];
        return events;
    }
}

export class TruffleTransactionInterceptor extends TransactionInterceptor {
    private handledPromises: Promise<void>[] = [];
    private startRealTime = currentRealTime();
    private contractTypeName: Map<string, string> = new Map();  // address => type name

    constructor(
        private eventDecoder: Web3EventDecoder,
    ) { 
        super();
    }
    
    public logViewMethods: boolean = true;

    captureEvents(contracts: { [name: string]: Truffle.ContractInstance; }, filter?: string[]) {
        for (const [name, contract] of Object.entries(contracts)) {
            this.instrumentContractForEventCapture(contract);
            this.contractTypeName.set(contract.address, name);
        }
        this.eventDecoder.addContracts(contracts, filter);
    }

    captureEventsFrom(contractName: string, contract: Truffle.ContractInstance, typeName?: string | null, filter?: string[]) {
        this.captureEvents({ [contractName]: contract }, filter);
        if (typeName) {
            this.contractTypeName.set(contract.address, typeName);
        }
    }

    private instrumentContractForEventCapture(contract: Truffle.ContractInstance) {
        const cc = contract as any;
        for (const [name, method] of Object.entries(cc)) {
            if (typeof method !== 'function' || name === 'constructor') continue;
            const subkeys = tryCatch(() => Object.keys(method as any)) ?? [];
            const validMethod = (subkeys.includes('call') && subkeys.includes('sendTransaction') && subkeys.includes('estimateGas'))
                || (name === 'sendTransaction');
            if (!validMethod) continue;
            cc[name] = (...args: unknown[]) => {
                const txLog: string[] = [];
                const callStartTime = currentRealTime();
                // log method call
                const fmtArgs = args.map(arg => this.eventDecoder.formatArg(arg)).join(', ');
                txLog.push(`${this.eventDecoder.formatAddress(contract.address)}.${name}(${fmtArgs})   [AT(rt)=${(callStartTime - this.startRealTime).toFixed(3)}]`);
                // call method
                const promise = method(...args);
                let writeToLog = true;
                // handle success/failure
                if (promise instanceof Promise) {
                    const decodePromise = promise
                        .then((result: any) => {
                            const receipt = this.getTransactionReceipt(result);
                            if (receipt != null) {
                                this.handleMethodSuccess(contract, name, txLog, callStartTime, receipt);
                            } else if (this.logViewMethods) {
                                this.handleViewMethodSuccess(contract, name, txLog, callStartTime, result);
                            } else {
                                writeToLog = false;
                            }
                        })
                        .catch((e: unknown) => {
                            txLog.push(`    !!! ${e}`);
                            this.increaseErrorCount(e);
                        })
                        .finally(() => {
                            if (this.logFile != null && writeToLog) {
                                this.log(txLog.join('\n'));
                            }
                        });
                    this.handledPromises.push(decodePromise);
                }
                // and return the same promise, to be used by as without interceptor
                return promise;
            };
            // copy subkeys from method (call, sendTransaction, estimateGas)
            for (const key of subkeys) {
                cc[name][key] = (method as any)[key];
            }
        }
    }
    
    private getTransactionReceipt(result: any): TransactionReceipt | null {
        // (approximately) detect if the returned result is either TransactionResponse or TransactionReceipt and in this case extract receipt
        if (result == null) {
            return null;
        } else if (typeof result.tx === 'string' && result.receipt != null && Array.isArray(result.logs)) {
            return result.receipt; // result is TransactionResponse
        } else if (typeof result.status === 'boolean' && typeof result.transactionHash === 'string' && Array.isArray(result.logs)) {
            return result; // result is TransactionReceipt
        }
        return null;
    }

    private handleMethodSuccess(contract: Truffle.ContractInstance, method: string, txLog: string[], callStartTime: number, receipt: TransactionReceipt) {
        try {
            const callEndTime = currentRealTime();
            // gas info
            const qualifiedMethod = `${this.contractTypeName.get(contract.address) ?? contract.address}.${method}`;
            getOrCreate(this.gasUsage, qualifiedMethod, () => new Statistics()).add(receipt.gasUsed);
            // read events
            const events = this.eventDecoder.decodeEvents(receipt);
            // print events
            if (this.logFile != null) {
                txLog.push(`    GAS: ${receipt.gasUsed},  BLOCK: ${receipt.blockNumber},  DURATION(rt): ${(callEndTime - callStartTime).toFixed(3)}`);
                for (const event of events) {
                    txLog.push(`    ${this.eventDecoder.format(event)}`);
                    this.increaseEventCount(event);
                }
            }
            // call handlers
            for (const event of events) {
                for (const handler of this.eventHandlers.values()) {
                    handler(event);
                }
            }
        } catch (e) {
            txLog.push(`???? ERROR decoding/handling method call ${method}: ${e}`);
        }
    }

    private handleViewMethodSuccess(contract: Truffle.ContractInstance, method: string, txLog: string[], callStartTime: number, result: any) {
        try {
            const callEndTime = currentRealTime();
            if (this.logFile != null) {
                txLog.push(`    DURATION(rt): ${(callEndTime - callStartTime).toFixed(3)}`);
                txLog.push(`    RESULT: ${stringifyJson(truffleResultAsDict(result))}`);
            }
        } catch (e) {
            txLog.push(`???? ERROR decoding/handling view method call ${method}: ${e}`);
        }
    }
    
    async allHandled() {
        await Promise.all(this.handledPromises);
        this.handledPromises = [];
    }
}
