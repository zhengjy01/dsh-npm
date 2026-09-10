/**
 * dsh-npm — loopback HTTP routes for the web settings panel.
 *
 * Route family: /api/dsh-npm/*. All routes are loopback-only
 * (127.0.0.1/localhost, same-origin). The panel reads/writes the config
 * (registry/token) and runs quick package lookups through the same
 * registry client the tools use.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NpmStore } from './store.ts';
/** Route paths. */
export declare const NPM_API: {
    readonly config: "/api/dsh-npm/config";
    readonly info: "/api/dsh-npm/info";
    readonly search: "/api/dsh-npm/search";
};
/** Route dependencies. */
export interface RouteContext {
    store: NpmStore;
}
/** Build the route list for ctx.webServer.register. */
export declare function makeRoutes(deps: RouteContext): ({
    kind: "exact";
    path: "/api/dsh-npm/config";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-npm/info";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | {
    kind: "exact";
    path: "/api/dsh-npm/search";
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
})[];
