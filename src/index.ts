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

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { NpmStore } from './store.ts'
import { buildTools } from './tools.ts'
import { makeRoutes, NPM_API } from './routes.ts'

/** Stable cordis plugin name. */
export const name = 'npm'

/** Services required before the npm surfaces can mount. */
export const inject = ['tools', 'systemPrompt', 'webServer']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 161

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const NPM_GUIDANCE =
  '本机已安装 dsh-npm 插件（NPM 包管理）：可用 npm_info 查询包信息（最新版本/dist-tags/依赖摘要）、npm_versions 列出全部版本及发布时间、' +
  'npm_search 搜索 registry 上的包；npm_publish 真实执行 npm publish（默认复用本机 ~/.npmrc 登录凭据，也可用 npm_config 配置 registry 与 token，' +
  'token 存 ~/.dsh/dsh-npm.json 权限 0600）；npm_deprecate 标记弃用；npm_status 查看插件状态。' +
  '发布是真实写入 registry 的操作，发布前先用 npm_info / npm_versions 确认版本号不存在，建议先 dryRun: true 预检；' +
  'force: true 可覆盖已发布版本（危险）。用户提到「npm / NPM / 发布包 / 查包 / 发包 / 搜索包」时即指本插件，请据此协作。'

/** Plugin config, read from the composition row. */
export interface Config {
  /** When true (default), a system-prompt section announces the plugin. */
  announceToAgent?: boolean
  /** Master switch for the plugin (tools, prompt section). */
  enabled?: boolean
}

/**
 * Mount the npm tools and announcement.
 * @param ctx - host plugin context carrying tools/systemPrompt.
 * @param config - plugin config from the composition row.
 */
export function apply(ctx: Context, config?: Config): void {
  const announceToAgent = config?.announceToAgent !== false
  const enabled = config?.enabled !== false
  const store = new NpmStore()
  const toolContext = { store }

  let disposeTools: (() => void) | undefined
  let disposeRoutes: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  const sync = (): void => {
    if (disposeTools !== undefined) {
      disposeTools()
      disposeTools = undefined
    }
    if (disposeRoutes !== undefined) {
      disposeRoutes()
      disposeRoutes = undefined
    }
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    if (!enabled) return
    disposeTools = ctx.effect(
      () => {
        const disposers = buildTools(toolContext).map((tool) => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-npm: tools',
    )
    disposeRoutes = ctx.effect(
      () => {
        const disposers = makeRoutes({ store }).map((route) => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-npm: routes',
    )
    if (announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-npm',
        order: SECTION_ORDER,
        text: NPM_GUIDANCE,
      })
    }
  }

  sync()
}

/** Re-exports for host consumers and the smoke tests. */
export { NpmStore, DEFAULT_REGISTRY, mask, configPath, normalizeRegistry, type NpmConfig, type NpmConfigView } from './store.ts'
export { NpmRegistryError, getPackage, getVersions, searchPackages, packageUrl, type PackageInfo, type VersionEntry, type SearchHit } from './registry.ts'
export { npmEnv, runNpm, publishPackage, deprecatePackage, type NpmEnv, type NpmRunResult, type PublishOptions } from './publish.ts'
export { npmStatusTool, npmConfigTool, npmInfoTool, npmVersionsTool, npmSearchTool, npmPublishTool, npmDeprecateTool, buildTools, type ToolContext } from './tools.ts'
export { makeRoutes, NPM_API } from './routes.ts'
export { defineTool }
