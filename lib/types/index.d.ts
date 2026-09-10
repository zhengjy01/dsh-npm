/**
 * dsh-npm — NPM registry management for DeepSeek Harness.
 * Host half.
 *
 * Mounts the npm tools (status / config / info / versions / search /
 * publish / deprecate) and a system-prompt announcement. Registry queries
 * ride the public npm registry JSON API; publish/deprecate shell out to
 * the local npm CLI, reusing ~/.npmrc credentials or the optional token
 * stored in ~/.dsh/dsh-npm.json (mode 0600). No dsh source changes.
 */
import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
/** Stable cordis plugin name. */
export declare const name = "npm";
/** Services required before the npm surfaces can mount. */
export declare const inject: string[];
/** Model-facing announcement: plugin presence, capabilities, and limits. */
export declare const NPM_GUIDANCE: string;
/** Plugin config, read from the composition row. */
export interface Config {
    /** When true (default), a system-prompt section announces the plugin. */
    announceToAgent?: boolean;
    /** Master switch for the plugin (tools, prompt section). */
    enabled?: boolean;
}
/**
 * Mount the npm tools and announcement.
 * @param ctx - host plugin context carrying tools/systemPrompt.
 * @param config - plugin config from the composition row.
 */
export declare function apply(ctx: Context, config?: Config): void;
/** Re-exports for host consumers and the smoke tests. */
export { NpmStore, DEFAULT_REGISTRY, mask, configPath, normalizeRegistry, type NpmConfig, type NpmConfigView } from './store.ts';
export { NpmRegistryError, getPackage, getVersions, searchPackages, packageUrl, type PackageInfo, type VersionEntry, type SearchHit } from './registry.ts';
export { npmEnv, runNpm, publishPackage, deprecatePackage, type NpmEnv, type NpmRunResult, type PublishOptions } from './publish.ts';
export { npmStatusTool, npmConfigTool, npmInfoTool, npmVersionsTool, npmSearchTool, npmPublishTool, npmDeprecateTool, buildTools, type ToolContext } from './tools.ts';
export { makeRoutes, NPM_API } from './routes.ts';
export { defineTool };
