import { reportError } from "../helpers";
import { EventScope, ExitScope } from "./ScopedEvents";

export class ScopedRunner {
    logError: (e: any) => void = reportError;

    scopes = new Set<EventScope>();

    lastThreadId = 0;
    runningThreads = new Map<number, Function>();

    uncaughtErrors: any[] = [];

    get runningThreadCount() {
        return this.runningThreads.size;
    }

    newScope(parentScope?: EventScope) {
        const scope = new EventScope(parentScope);
        this.scopes.add(scope);
        return scope;
    }

    finishScope(scope: EventScope) {
        scope.finish();
        this.scopes.delete(scope);
    }

    startThread(method: (scope: EventScope) => Promise<void>): number {
        const scope = this.newScope();
        const threadId = ++this.lastThreadId;
        this.runningThreads.set(threadId, method);
        void method(scope)
            .catch(e => {
                if (e instanceof ExitScope) {
                    if (e.scope == null || e.scope === scope) return;
                }
                this.logError(e);
                this.uncaughtErrors.push(e);
            })
            .finally(() => {
                this.runningThreads.delete(threadId)
                return this.finishScope(scope);
            });
        return threadId;
    }

    async startScope(method: (scope: EventScope) => Promise<void>): Promise<void> {
        return this.startScopeIn(undefined, method);
    }

    async startScopeIn(parentScope: EventScope | undefined, method: (scope: EventScope) => Promise<void>): Promise<void> {
        const scope = this.newScope(parentScope);
        try {
            await method(scope);
        } finally {
            this.finishScope(scope);
        }
    }
}
