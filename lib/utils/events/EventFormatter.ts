import BN from "bn.js";
import { BaseEvent } from "./common";
import { formatBN } from "../helpers";


export class EventFormatter {
    public formatArgsWithNames: boolean = true;
    public contractNames = new Map<string, string>(); // address => name

    addAddress(name: string, address: string) {
        this.contractNames.set(address, name);
    }

    addAddresses(addressMap: { [name: string]: string; }) {
        for (const [name, address] of Object.entries(addressMap)) {
            this.contractNames.set(address, name);
        }
    }

    isAddress(s: any): s is string {
        return typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s);
    }

    formatAddress(address: string) {
        return this.contractNames.get(address) ?? address.slice(0, 10) + '...';
    }

    formatArg(value: unknown): string {
        if (this.isBigNumber(value)) {
            return this.formatBN(value);
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

    isBigNumber(x: any) {
        return BN.isBN(x) || (typeof x === 'string' && /^\d+$/.test(x));
    }

    formatBN(x: any) {
        return formatBN(x);
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
