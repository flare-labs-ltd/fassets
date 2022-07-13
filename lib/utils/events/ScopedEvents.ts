import { ErrorFilter, expectErrors, filterStackTrace } from "../helpers";
import { ILogger } from "../logging";

export type EventHandler<E> = (event: E) => void;

export interface EventSubscription {
    unsubscribe(): void;
}

export class ClearableSubscription implements EventSubscription {
    constructor(
        public base?: EventSubscription
    ) { }

    unsubscribe(): void {
        if (this.base) {
            this.base.unsubscribe();
            this.base = undefined;
        }
    }

    static of(unsubscribe: () => void) {
        return new ClearableSubscription({ unsubscribe });
    }
}

class ScopedSubscription implements EventSubscription {
    constructor(
        private scope?: EventScope,
        private subscription?: EventSubscription,
    ) { }

    unsubscribe(): void {
        if (this.subscription) {
            if (this.scope) {
                this.scope.remove(this.subscription);
                this.scope = undefined;
            }
            this.subscription.unsubscribe();
            this.subscription = undefined;
        }
    }
}

export class ExitScope extends Error {
    constructor(public scope?: EventScope) {
        super("no matching scope");
    }
}

export class EventScope {
    constructor(
        private parent?: EventScope
    ) {
        if (parent) {
            parent.children.add(this);
        }
    }
    
    private subscriptions: Set<EventSubscription> = new Set();
    private children: Set<EventScope> = new Set();

    add(subscription: EventSubscription): EventSubscription {
        this.subscriptions.add(subscription);
        return new ScopedSubscription(this, subscription);
    }

    finish(): void {
        for (const child of this.children) {
            child.parent = undefined;   // prevent deleting from this.children
            child.finish();
        }
        this.children.clear();
        for (const subscription of this.subscriptions) {
            subscription.unsubscribe();
        }
        this.subscriptions.clear();
        this.parent?.children.delete(this);
    }

    remove(subscription: EventSubscription) {
        this.subscriptions.delete(subscription);
    }
    
    exit(): never {
        throw new ExitScope(this);
    }
    
    exitOnExpectedError(error: any, expectedErrors: ErrorFilter[]): never {
        expectErrors(error, expectedErrors);
        throw new ExitScope(this);
    }
}

export interface QualifiedEvent<N extends string, A> {
    name: N;
    args: A;
}

export class EventEmitter<E> {
    constructor(
        private executionQueue: EventExecutionQueue | null,
        protected _subscribe: (handler: EventHandler<E>) => EventSubscription,
    ) { }

    subscribe(handler: EventHandler<E>): EventSubscription {
        const executionQueue = this.executionQueue;
        if (executionQueue) {
            return this._subscribe((args: E) => {
                executionQueue.push(() => handler(args));
            });
        } else {
            return this._subscribe(handler);
        }
    }

    subscribeOnce(handler: EventHandler<E>): EventSubscription {
        const subscription = new ClearableSubscription();
        subscription.base = this.subscribe(event => {
            subscription.unsubscribe();
            handler(event);
        });
        return subscription;
    }

    subscribeIn(scope: EventScope, handler: EventHandler<E>) {
        const subscription = this.subscribe(handler);
        return scope.add(subscription);
    }

    subscribeOnceIn(scope: EventScope, handler: EventHandler<E>) {
        const subscription = this.subscribeOnce(handler);
        return scope.add(subscription);
    }
    
    wait(scope?: EventScope): Promise<E> {
        if (scope) {
            return new Promise((resolve) => this.subscribeOnceIn(scope, resolve));
        } else {
            return new Promise((resolve) => this.subscribeOnce(resolve));
        }
    }
    
    filter(condition: (event: E) => boolean): EventEmitter<E> {
        return new EventEmitter<E>(this.executionQueue, (handler) => this._subscribe(event => {
            if (condition(event)) handler(event);
        }));
    }

    map<F>(convert: (event: E) => F): EventEmitter<F> {
        return new EventEmitter<F>(this.executionQueue, (handler) => this._subscribe(event => {
            handler(convert(event));
        }));
    }
    
    qualified<N extends string>(name: N): EventEmitter<QualifiedEvent<N, E>> {
        return new EventEmitter(this.executionQueue, (handler) => {
            return this.subscribe((args: E) => handler({ name, args }));
        });
    }
    
    // convert to emitter without queue (immediate)
    immediate() {
        if (this.executionQueue == null) return this;   // already immediate
        return new EventEmitter<E>(null, this._subscribe);
    }
}

export class EventExecutionQueue {
    public logger?: ILogger;
    private queue: Array<() => void> = [];
    
    push(item: () => void) {
        this.queue.push(item);
    }
    
    get length() {
        return this.queue.length;
    }

    runAll() {
        const queue = this.queue;
        this.queue = [];
        for (const item of queue) {
            try {
                item();
            } catch (e) {
                this.logger?.log(`!!! HANDLER ERROR ${filterStackTrace(e)}`);
            }
        }
    }
}

export class TriggerableEvent<E> extends EventEmitter<E> {
    constructor(executionQueue: EventExecutionQueue | null = null) {
        super(executionQueue, handler => {
            this.handlers.add(handler);
            return { unsubscribe: () => this.handlers.delete(handler) };
        });
    }
    
    private handlers = new Set<EventHandler<E>>();
    
    trigger(event: E) {
        for (const handler of this.handlers) {
            handler(event);
        }
    }
}

export function qualifiedEvent<N extends string, A>(name: N, args: A): QualifiedEvent<N, A> {
    return { name, args };
}

export function timeoutEvent(executionQueue: EventExecutionQueue | null, ms: number) {
    return new EventEmitter<void>(executionQueue, (handler) => {
        const timerId = setTimeout(handler, ms);
        return ClearableSubscription.of(() => clearTimeout(timerId));
    });
}

export function intervalEvent(executionQueue: EventExecutionQueue | null, ms: number) {
    return new EventEmitter<void>(executionQueue, (handler) => {
        const timerId = setInterval(handler, ms);
        return ClearableSubscription.of(() => clearInterval(timerId));
    });
}
