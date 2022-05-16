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
}

export class EventEmitter<E> {
    constructor(
        private _subscribe: (handler: EventHandler<E>) => EventSubscription,
    ) { }

    public subscribe(handler: EventHandler<E>): EventSubscription {
        return this._subscribe(handler);
    }

    public subscribeOnce(handler: EventHandler<E>): EventSubscription {
        const subscription = new ClearableSubscription();
        subscription.base = this._subscribe(event => {
            subscription.unsubscribe();
            handler(event);
        });
        return subscription;
    }

    public subscribeIn(scope: EventScope, handler: EventHandler<E>) {
        const subscription = this._subscribe(handler);
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
}
