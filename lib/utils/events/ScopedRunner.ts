import { reportError } from "../helpers";
import { EventScope, ExitScope } from "./ScopedEvents";

export class ScopedRunner {
    logError: (e: any) => void = reportError;

    scopes = new Set<EventScope>();
    runningThreads = 0;

    uncaughtErrors: any[] = [];

    newScope(parentScope?: EventScope) {
        const scope = new EventScope(parentScope);
        this.scopes.add(scope);
        return scope;
    }

    finishScope(scope: EventScope) {
        scope.finish();
        this.scopes.delete(scope);
    }

    startThread(method: (scope: EventScope) => Promise<void>): void {
        const scope = this.newScope();
        ++this.runningThreads;
        void method(scope)
            .catch(e => {
                if (e instanceof ExitScope) {
                    if (e.scope == null || e.scope === scope) return;
                }
                this.logError(e);
                this.uncaughtErrors.push(e);
            })
            .finally(() => {
                --this.runningThreads;
                return this.finishScope(scope);
            });
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
