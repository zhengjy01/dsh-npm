/**
 * dsh-npm — credential/registry store.
 *
 * Persists the npm registry override and (optional) auth token to
 * ~/.dsh/dsh-npm.json (mode 0600). Reads are lazy and cached; the public
 * view() never exposes the token. The config path can be overridden with
 * DSH_NPM_CONFIG (used by the smoke tests).
 */
/** Default machine-wide config location (mode 0600). */
export declare const DEFAULT_CONFIG_FILE: string;
/** Default registry when none is configured. */
export declare const DEFAULT_REGISTRY = "https://registry.npmjs.org/";
/** Test override for the config location. */
export declare function configPath(): string;
/** Persisted configuration shape. The token never leaves this module. */
export interface NpmConfig {
    /** Registry base URL ('' means DEFAULT_REGISTRY). */
    registry: string;
    /** Optional npm auth token for private packages / publishing. */
    token: string;
}
/** Public, secret-free status view. */
export interface NpmConfigView {
    configured: boolean;
    /** Effective registry base URL (configured or default). */
    registry: string;
    /** Whether the registry was explicitly configured (vs default). */
    registryConfigured: boolean;
    /** Whether an auth token is present. */
    tokenConfigured: boolean;
    tokenMasked: string;
    configPath: string;
}
/** Mask a credential for display, keeping only the head and tail. */
export declare function mask(value: string): string;
/**
 * Registry credential/token store with lazy cached reads and masked views.
 */
export declare class NpmStore {
    private cached;
    /** Current file path (honors the DSH_NPM_CONFIG override). */
    readonly file: string;
    /** Read the config (lazy, cached). */
    read(): Promise<NpmConfig>;
    /** Effective registry base URL (configured or default). */
    registry(): Promise<string>;
    /** Whether an auth token is present. */
    token(): Promise<string>;
    /** Effective registry host (for building npm userconfig auth lines). */
    registryHost(): Promise<string>;
    /** Persist a patch (registry/token) or clear everything with reset. */
    patch(patch: {
        registry?: string;
        token?: string;
        reset?: boolean;
    }): Promise<NpmConfigView>;
    /** Public secret-free view. */
    view(): Promise<NpmConfigView>;
}
/** Normalize a registry URL to a trailing-slash base URL. */
export declare function normalizeRegistry(registry: string): string;
