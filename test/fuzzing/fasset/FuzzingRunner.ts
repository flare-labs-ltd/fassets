import { reportError } from "../../utils/helpers";
import { EventScope } from "./EventEmitter";

export class FuzzingRunner {
    scopes = new Set<EventScope>();

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
        void method(scope)
            .catch(e => reportError(e))
            .finally(() => this.finishScope(scope));
    }
    
    async startScope(method: (scope: EventScope) => Promise<void>) {
        return this.startScopeIn(undefined, method);
    }
    
    async startScopeIn(parentScope: EventScope | undefined, method: (scope: EventScope) => Promise<void>) {
        const scope = this.newScope(parentScope);
        try {
            await method(scope);
        } catch (e) {
            reportError(e);
        } finally {
            this.finishScope(scope);
        }
    }
}
