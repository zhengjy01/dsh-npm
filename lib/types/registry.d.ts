/**
 * dsh-npm — npm registry HTTP client.
 *
 * Read-only registry queries (package metadata, version list, search) via
 * the public npm registry JSON API. Optional Bearer token from the store
 * enables private-package lookups. Every function resolves to plain
 * JSON-safe data; errors are normalized into friendly messages.
 */
import type { NpmStore } from './store.ts';
/** Error raised for registry-level failures (not found, network, auth…). */
export declare class NpmRegistryError extends Error {
    readonly status: number | null;
    constructor(message: string, status?: number | null);
}
/** JSON-safe registry metadata view for one package. */
export interface PackageInfo {
    name: string;
    description: string;
    latestVersion: string;
    distTags: Record<string, string>;
    versionCount: number;
    license: string;
    author: string;
    homepage: string;
    repository: string;
    keywords: string[];
    created: string;
    modified: string;
    /** Dependency summary of the latest version (name → range). */
    latestDependencies: Record<string, string>;
    /** Engines of the latest version (name → range). */
    latestEngines: Record<string, string>;
}
/** One version entry with publish time. */
export interface VersionEntry {
    version: string;
    /** ISO publish timestamp ('' when unknown). */
    publishedAt: string;
}
/** One search hit. */
export interface SearchHit {
    name: string;
    version: string;
    description: string;
    author: string;
    keywords: string[];
    /** ISO publish date of that version. */
    date: string;
    searchScore: number;
}
/** Registry query options (auth token + explicit registry override). */
export interface RegistryOptions {
    /** Explicit registry override for this call. */
    registry?: string;
    token?: string;
}
/**
 * Normalize a package name into the registry's URL path segment. Scoped
 * names (@scope/name) must be encoded as a whole (@scope%2fname).
 */
export declare function packagePath(name: string): string;
/** Build the full metadata URL for a package. */
export declare function packageUrl(base: string, name: string): string;
/** Resolve effective registry base for a call. */
export declare function resolveRegistry(store: NpmStore, explicit?: string): Promise<string>;
/** Resolve token for a call (explicit beats store). */
export declare function resolveToken(store: NpmStore, explicit?: string): Promise<string>;
/** Fetch full package metadata. Throws NpmRegistryError on 404/network. */
export declare function getPackage(store: NpmStore, name: string, options?: RegistryOptions): Promise<PackageInfo>;
/** List every published version with its publish time (latest tag first). */
export declare function getVersions(store: NpmStore, name: string, options?: RegistryOptions): Promise<{
    versions: VersionEntry[];
    distTags: Record<string, string>;
    name: string;
}>;
/** Search packages on the registry. Throws NpmRegistryError on failure. */
export declare function searchPackages(store: NpmStore, query: string, size: number, options?: RegistryOptions): Promise<{
    hits: SearchHit[];
    total: number;
}>;
