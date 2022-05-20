import { expectErrors, filterStackTrace } from "../../utils/helpers";
import { LogFile } from "../../utils/LogFile";

export type EventHandler<E> = (event: E) => void;

export interface EventSubscription {
    unsubscribe(): void;
}

export class ExitScope extends Error {
    constructor(public scope?: EventScope) {
        super("no matching scope");
    }
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
    
    exitOnExpectedError(e: any, expectedMessages: string[]): never {
        expectErrors(e, expectedMessages);
        throw new ExitScope(this);
    }
}

export interface QualifiedEvent<N extends string, A> {
    name: N;
    args: A;
}

export function qualifiedEvent<N extends string, A>(name: N, args: A): QualifiedEvent<N, A> {
    return { name, args };
}

export class EventEmitter<E> {
    constructor(
        protected _subscribe: (handler: EventHandler<E>) => EventSubscription,
    ) { }

    public subscribe(handler: EventHandler<E>): EventSubscription {
        return this._subscribe(handler);
    }

    public subscribeOnce(handler: EventHandler<E>): EventSubscription {
        const subscription = new ClearableSubscription();
        subscription.base = this.subscribe(event => {
            subscription.unsubscribe();
            handler(event);
        });
        return subscription;
    }

    public subscribeIn(scope: EventScope, handler: EventHandler<E>) {
        const subscription = this.subscribe(handler);
        return scope.add(subscription);
    }

    public subscribeOnceIn(scope: EventScope, handler: EventHandler<E>) {
        const subscription = this.subscribeOnce(handler);
        return scope.add(subscription);
    }

    public wait(scope?: EventScope): Promise<E> {
        if (scope) {
            return new Promise((resolve) => this.subscribeOnceIn(scope, resolve));
        } else {
            return new Promise((resolve) => this.subscribeOnce(resolve));
        }
    }
    
    qualified<N extends string>(name: N): EventEmitter<QualifiedEvent<N, E>> {
        return new EventEmitter((handler) => {
            return this.subscribe((args: E) => handler({ name, args }));
        });
    }
}

export class EventExecutionQueue {
    public logFile?: LogFile;
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
                if (this.logFile) {
                    this.logFile.log(`!!! HANDLER ERROR ${filterStackTrace(e)}`);
                }
            }
        }
    }
}

export class QueuedEventEmitter<E> extends EventEmitter<E> {
    constructor(
        private executionQueue: EventExecutionQueue,
        _subscribe: (handler: EventHandler<E>) => EventSubscription,
    ) {
        super(_subscribe);
    }
    
    public override subscribe(handler: EventHandler<E>): EventSubscription {
        return this._subscribe((args: E) => {
            this.executionQueue.push(() => handler(args));
        });
    }
}
