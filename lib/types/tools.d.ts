/**
 * dsh-npm — model-facing tools.
 *
 * Mounted via ctx.tools.register. Covers the full npm surface: status,
 * config (registry/token), package info, version list, registry search,
 * publish, and deprecate. Query tools hit the registry HTTP API directly
 * (no local npm needed); publish/deprecate shell out to the local `npm`
 * CLI and reuse the user's own ~/.npmrc credentials (or the configured
 * token). Every tool resolves to { ok, message, ... } and never throws for
 * API-level outcomes.
 */
import { type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { NpmStore } from './store.ts';
import { DEFAULT_REGISTRY, mask } from './store.ts';
/** Shared tool dependencies. */
export interface ToolContext {
    store: NpmStore;
}
/** Local JsonValue-compatible alias (matches the tools SDK contract). */
type JsonSafe = null | boolean | number | string | JsonSafe[] | {
    [key: string]: JsonSafe;
};
/** Compact search-hit view (JsonValue-safe). */
export interface SearchHitView extends Record<string, JsonSafe> {
    name: string;
    version: string;
    description: string;
    author: string;
    keywords: string[];
    date: string;
}
/** Compact version view (JsonValue-safe). */
export interface VersionView extends Record<string, JsonSafe> {
    version: string;
    publishedAt: string;
}
/** JSON-safe published package reference. */
export interface PublishedRef extends Record<string, JsonSafe> {
    name: string;
    version: string;
    tag: string;
}
/** Tool: connection/plugin status. */
export declare function npmStatusTool(ctx: ToolContext): ToolDefinition;
/** Tool: configure registry/token. */
export declare function npmConfigTool(ctx: ToolContext): ToolDefinition;
/** Tool: package info. */
export declare function npmInfoTool(ctx: ToolContext): ToolDefinition;
/** Tool: version list. */
export declare function npmVersionsTool(ctx: ToolContext): ToolDefinition;
/** Tool: registry search. */
export declare function npmSearchTool(ctx: ToolContext): ToolDefinition;
/** Tool: publish. */
export declare function npmPublishTool(ctx: ToolContext): ToolDefinition;
/** Tool: deprecate. */
export declare function npmDeprecateTool(ctx: ToolContext): ToolDefinition;
/** Build every tool for the registry. */
export declare function buildTools(ctx: ToolContext): ToolDefinition[];
/** Re-export helpers for host consumers and smoke tests. */
export { DEFAULT_REGISTRY, mask };
