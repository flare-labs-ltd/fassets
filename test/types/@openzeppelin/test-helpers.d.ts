/// <reference types="../../../typechain-truffle/types" /> 

declare module "@openzeppelin/test-helpers" {
    import BN from "bn.js";

    export type BalanceUnit = 'wei' | 'gwei' | 'ether';
    
    export type StringForBN<T> = { [K in keyof T]: T[K] extends BN ? BN | string : T[K] };

    export namespace constants {
        /**
         * The initial value of an address type variable, i.e., address(0) in Solidity.
         */
        const ZERO_ADDRESS: string;

        /**
         * The initial value of a bytes32 type variable, i.e., bytes32(0x00) in Solidity.
         */
        const ZERO_BYTES32: string;

        /**
         * The maximum unsigned integer 2^256 - 1 represented in BN.
         */
        const MAX_UINT256: BN;

        /**
         * The maximum signed integer 2^255 - 1 represented in BN.
         */
        const MAX_INT256: BN;

        /**
         * The minimum signed integer -2\^255 represented in BN.
         */
        const MIN_INT256: BN;
    }

    export namespace balance {
        /**
         * Returns the current balance of an account.
         * @param account account address
         * @param unit 'wei' | 'gwei' | 'ether', default 'wei'
         */
        function current(account: string, unit?: BalanceUnit): Promise<BN>;

        /**
         * Creates an instance of a balance tracker, which lets you keep track of the changes in an account’s Ether balance.
         * @param account account address
         * @param unit 'wei' | 'gwei' | 'ether', default 'wei'
         */
        function tracker(account: string, unit?: BalanceUnit): Promise<{
            /**
             * Returns the current balance of an account.
             * @param unit 'wei' | 'gwei' | 'ether', default tracker.unit
             */
            get(unit?: BalanceUnit): Promise<BN>;

            /**
             * Returns the change in the balance since the last time it was checked (with either get() or delta()).
             * @param unit 'wei' | 'gwei' | 'ether', default tracker.unit
             */
            delta(unit?: BalanceUnit): Promise<BN>;
        }>;
    }

    /**
     * Converts a value in Ether to wei.
     */
    export function ether(value: BN | number | string): BN;

    /**
     * Asserts that the logs in `response` contain an event with name `eventName` and arguments that match
     *  those specified in `eventArgs`.
     * @param response an object returned by either a web3 Contract or a truffle-contract call.
     * @param eventName name of the event
     * @param eventArgs expected event args (not necessarily all)
     */
    export function expectEvent<T extends Truffle.AnyEvent>(response: Truffle.TransactionResponse<T>, eventName: T['name'], eventArgs?: Partial<StringForBN<T['args']>>): void;

    export namespace expectEvent {
        /**
         * Same as expectEvent, but for events emitted in an arbitrary transaction (of hash txHash), by an arbitrary contract 
         * (emitter, the contract instance), even if it was indirectly called (i.e. if it was called by another smart contract and not an externally owned account).
         * Note: emitter must be the deployed contract instance emitting the expected event.
         * Note 2: unlike expectEvent, returns a Promise.
         * @param receiptTx tx hash of the transaction (`response.tx` where `response` is an object returned by either a web3 Contract or a truffle-contract call.)
         * @param emitter the emitter contract
         * @param eventName name of the event
         * @param eventArgs expected event args (not necessarily all)
         */
        function inTransaction<T extends Truffle.AnyEvent = Truffle.AnyEvent>(receiptTx: string, emitter: Truffle.ContractInstance, eventName: T['name'], eventArgs?: Partial<StringForBN<T['args']>>): Promise<void>;

        /**
         * Same as inTransaction, but for events emitted during the construction of emitter. Note that this is currently only supported for truffle contracts.
         * Note: unlike expectEvent, returns a Promise.
         * @param emitter the emitter contract
         * @param eventName name of the event
         * @param eventArgs expected event args (not necessarily all)
         */
        function inConstruction<T extends Truffle.AnyEvent = Truffle.AnyEvent>(emitter: Truffle.ContractInstance, eventName: T['name'], eventArgs?: Partial<StringForBN<T['args']>>): Promise<void>;

        /**
         * Check that event was NOT emitted.
         * @param response an object returned by either a web3 Contract or a truffle-contract call.
         * @param eventName name of the event
         */
        function notEmitted<T extends Truffle.AnyEvent>(response: Truffle.TransactionResponse<T>, eventName: T['name']): void;

        namespace notEmitted {
            /**
             * Check that event was NOT emitted (for any contract `emitter` involved in the transaction).
             * Note: unlike expectEvent, returns a Promise.
             * @param receiptTx tx hash of the transaction (`response.tx` where `response` is an object returned by either a web3 Contract or a truffle-contract call.)
             * @param emitter the emitter contract
             * @param eventName name of the event
             */
            function inTransaction<T extends Truffle.AnyEvent = Truffle.AnyEvent>(receiptTx: string, emitter: Truffle.ContractInstance, eventName: T['name']): Promise<void>;

            /**
             * Check that event was NOT emitted during the construction of th emitter.
             * Note: unlike expectEvent, returns a Promise.
             * @param emitter the emitter contract
             * @param eventName name of the event
             */
            function inConstruction<T extends Truffle.AnyEvent = Truffle.AnyEvent>(emitter: Truffle.ContractInstance, eventName: T['name']): Promise<void>;
        }
    }

    /**
     * Helpers for transaction failure (similar to chai’s throw): asserts that promise was rejected due to a reverted transaction.
     * It will also check that the revert reason includes message. Use `expectRevert.unspecified` when the revert reason is unknown.
     * @param promise response of a transaction
     * @param message the expected revert message
     */
    export function expectRevert(promise: Promise<any>, message: string): Promise<void>;

    export namespace expectRevert {
        /**
         * Like expectRevert, asserts that promise was rejected due to a reverted transaction caused by a require or revert statement, but doesn’t check the revert reason.
         * @param promise response of a transaction
         */
        function unspecified(promise: Promise<any>): Promise<void>;

        /**
         * Asserts that promise was rejected due to a reverted transaction caused by an assert statement or an invalid opcode.
         * @param promise response of a transaction
         */
        function assertion(promise: Promise<any>): Promise<void>;

        /**
         * Asserts that promise was rejected due to a transaction running out of gas.
         * @param promise response of a transaction
         */
        function outOfGas(promise: Promise<any>): Promise<void>;
    }

    export namespace send {
        /**
         * Sends `value` Ether from `from` to `to`.
         * @param from account address
         * @param to account address
         * @param value number of wei
         */
        function ether(from: string, to: string, value: BN | number | string): Promise<any>;

        /**
         * Sends a transaction to contract target, calling method name with argValues, which are of type argTypes (as per the method’s signature).
         */
        function transaction(target: string, name: string, argsTypes: any, argsValues: any, opts?: Truffle.TransactionDetails): Promise<any>;
    }

    export namespace time {
        /**
         * Forces a block to be mined, incrementing the block height.
         */
        function advanceBlock(): Promise<void>;

        /**
         * Forces blocks to be mined until the the target block height is reached.
         * Note: Using this function to advance too many blocks can really slow down your tests. Keep its use to a minimum.
         * @param target the block number to which to mine
         */
        function advanceBlockTo(target: BN | number | string): Promise<void>;

        /**
         * Returns the timestamp of the latest mined block. Should be coupled with advanceBlock to retrieve the current blockchain time.
         */
        function latest(): Promise<BN>;

        /**
         * Returns the latest mined block number.
         */
        function latestBlock(): Promise<BN>;

        /**
         * Increases the time of the blockchain by duration (in seconds), and mines a new block with that timestamp.
         * @param duration duration in seconds, for conversion from other units use e.g. `time.duration.hours(2)`
         */
        function increase(duration: BN | number | string): Promise<void>;

        /**
         * Same as increase, but a target time is specified instead of a duration.
         * @param target target time in seconds since unix epoch
         */
        function increaseTo(target: BN | number | string): Promise<void>;

        export namespace duration {
            /**
             * Convert to seconds (identity). For use as argument of `time.increase`.
             */
            function seconds(seconds: number): number;

            /**
             * Convert minutes to seconds. For use as argument of `time.increase`.
             */
            function minutes(minutes: number): number;

            /**
             * Convert hours to seconds. For use as argument of `time.increase`.
             */
            function hours(hours: number): number;

            /**
             * Convert days to seconds. For use as argument of `time.increase`.
             */
            function days(days: number): number;

            /**
             * Convert weeks to seconds. For use as argument of `time.increase`.
             */
            function weeks(weeks: number): number;

            /**
             * Convert years to seconds. For use as argument of `time.increase`.
             */
            function years(years: number): number;
        }
    }

    export namespace makeInterfaceId {
        function ERC165(interfaces?: any[]): any;
        function ERC1820(name: any): any;
    }

    export namespace singletons {
        function ERC1820Registry(funder: any): Promise<any>;
    }
}
