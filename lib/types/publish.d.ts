/**
 * dsh-npm — npm CLI wrapper for publish / deprecate.
 *
 * Runs the local `npm` executable. Authentication reuses the user's own
 * ~/.npmrc by default; when the plugin store holds a token, it is injected
 * through a temporary --userconfig file (mode 0600, removed after the run)
 * so the token never appears on the command line or in logs.
 */
/**
 * Resolve an executable name to an absolute path.
 * @param name - bare executable name (without a Windows extension).
 * @returns the first existing absolute path, or the bare name so that the OS
 *   still performs its own PATH lookup (and reports a meaningful error).
 */
export declare function resolveExecutable(name: string): string;
/** Result of one npm CLI invocation. */
export interface NpmRunResult {
    code: number;
    stdout: string;
    stderr: string;
}
/** Environment probe for the status tool. */
export interface NpmEnv {
    available: boolean;
    version: string;
    /** Absolute path to the npm executable ('' when unavailable). */
    path: string;
    node: string;
}
/** Probe the local npm installation (fast, synchronous). */
export declare function npmEnv(): NpmEnv;
/**
 * Run npm with optional token injection via a temporary userconfig.
 * Never throws for non-zero exits — the caller inspects NpmRunResult.
 */
export declare function runNpm(args: string[], options?: {
    cwd?: string;
    timeoutMs?: number;
    token?: string;
    registryHost?: string;
}): Promise<NpmRunResult>;
/** Publish options mirroring npm publish flags. */
export interface PublishOptions {
    /** Package directory (default: current working directory). */
    dir?: string;
    /** Dist-tag to publish under (default: latest). */
    tag?: string;
    /** access=public|restricted for scoped packages. */
    access?: string;
    /** One-time password for 2FA-protected accounts. */
    otp?: string;
    /** Registry override. */
    registry?: string;
    /** Dry run (--dry-run): validate without uploading. */
    dryRun?: boolean;
    /** Force-publish an already-published version (dangerous). */
    force?: boolean;
    token?: string;
    registryHost?: string;
    timeoutMs?: number;
}
/** Publish a package via `npm publish`. */
export declare function publishPackage(options: PublishOptions): Promise<NpmRunResult>;
/** Deprecate a package/version via `npm deprecate`. */
export declare function deprecatePackage(spec: string, message: string, options?: {
    registry?: string;
    token?: string;
    registryHost?: string;
    timeoutMs?: number;
}): Promise<NpmRunResult>;
