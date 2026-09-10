/**
 * Browser-side API client for the /api/dsh-npm route family. The only
 * data access path the settings panel uses — plain fetch, same origin.
 */
/** Public config view (mirrors the host contract). */
export interface NpmConfigView {
    configured: boolean;
    registry: string;
    registryConfigured: boolean;
    tokenConfigured: boolean;
    tokenMasked: string;
    configPath: string;
}
/** Package info (panel view). */
export interface NpmPackageInfo {
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
    latestDependencies: Record<string, string>;
    latestEngines: Record<string, string>;
}
/** One search hit (panel view). */
export interface NpmSearchHit {
    name: string;
    version: string;
    description: string;
    author: string;
    keywords: string[];
    date: string;
    searchScore: number;
}
/** Error carrying the route's JSON error message. */
export declare class NpmApiError extends Error {
    constructor(message: string);
}
/** The npm panel API. */
export declare class NpmApi {
    getConfig(): Promise<NpmConfigView>;
    setConfig(patch: Record<string, unknown>): Promise<NpmConfigView>;
    info(name: string, registry?: string): Promise<{
        ok: boolean;
        info?: NpmPackageInfo;
        error?: string;
    }>;
    search(query: string, size?: number, registry?: string): Promise<{
        ok: boolean;
        total?: number;
        hits?: NpmSearchHit[];
        error?: string;
    }>;
}
