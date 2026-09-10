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

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { NpmRegistryError, getPackage, getVersions, searchPackages, type SearchHit, type VersionEntry } from './registry.ts'
import { deprecatePackage, npmEnv, publishPackage, type NpmEnv } from './publish.ts'
import type { NpmStore } from './store.ts'
import { DEFAULT_REGISTRY, mask } from './store.ts'

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Shared tool dependencies. */
export interface ToolContext {
  store: NpmStore
}

/** Local JsonValue-compatible alias (matches the tools SDK contract). */
type JsonSafe = null | boolean | number | string | JsonSafe[] | { [key: string]: JsonSafe }

/** Compact search-hit view (JsonValue-safe). */
export interface SearchHitView extends Record<string, JsonSafe> {
  name: string
  version: string
  description: string
  author: string
  keywords: string[]
  date: string
}

/** Compact version view (JsonValue-safe). */
export interface VersionView extends Record<string, JsonSafe> {
  version: string
  publishedAt: string
}

/** JSON-safe published package reference. */
export interface PublishedRef extends Record<string, JsonSafe> {
  name: string
  version: string
  tag: string
}

/** Parse `npm publish --json` stdout into a PublishedRef (best effort). */
function parsePublishedOutput(stdout: string): PublishedRef | null {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || !trimmed.startsWith('{')) continue
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof parsed.name === 'string' && typeof parsed.version === 'string') {
        return {
          name: parsed.name,
          version: parsed.version,
          tag: typeof parsed.tag === 'string' ? parsed.tag : '',
        }
      }
    } catch {
      // Try the next JSON-looking line.
    }
  }
  return null
}

/** Escape a message for use as a single npm deprecate argument. */
function deprecateMessage(message: string): string {
  return message.replace(/[\r\n]+/g, ' ').trim()
}

/** Tool: connection/plugin status. */
export function npmStatusTool(ctx: ToolContext) {
  return defineTool({
    name: 'npm_status',
    description: '查看 dsh-npm 插件状态：生效的 registry、是否配置了 auth token（不回显完整 token）、本机 npm CLI 是否可用及其版本、配置路径。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          registry: { type: 'string' },
          registryConfigured: { type: 'boolean' },
          tokenConfigured: { type: 'boolean' },
          tokenMasked: { type: 'string' },
          npmAvailable: { type: 'boolean' },
          npmVersion: { type: 'string' },
          nodeVersion: { type: 'string' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute() {
      const view = await ctx.store.view()
      const env: NpmEnv = npmEnv()
      const lines = [
        'registry：' + view.registry + (view.registryConfigured ? '（已配置）' : '（默认）'),
        'token：' + (view.tokenConfigured ? '已配置（' + view.tokenMasked + '）' : '未配置（查询公共包 / 用本机 ~/.npmrc 发布）'),
        'npm CLI：' + (env.available ? '可用（v' + env.version + '）' : '不可用（发布/弃用功能将无法使用）'),
        'node：' + env.node,
        '配置路径：' + view.configPath,
      ]
      return {
        ok: true,
        message: 'dsh-npm：' + lines.join('；') + '。查询用 npm_info / npm_versions / npm_search，发布用 npm_publish。',
        registry: view.registry,
        registryConfigured: view.registryConfigured,
        tokenConfigured: view.tokenConfigured,
        tokenMasked: view.tokenMasked,
        npmAvailable: env.available,
        npmVersion: env.version,
        nodeVersion: env.node,
        configPath: view.configPath,
      }
    },
  })
}

/** Tool: configure registry/token. */
export function npmConfigTool(ctx: ToolContext) {
  return defineTool({
    name: 'npm_config',
    description: '配置 dsh-npm：registry 为 npm registry 基础地址（如 https://registry.npmjs.org/ 或私有 registry，留空恢复默认）；token 为可选 npm auth token（发布私有包 / 查询私有包用，写入 ~/.dsh/dsh-npm.json，权限 0600，任何输出都不会回显完整 token）；传 reset: true 清除全部配置。',
    parameters: {
      registry: { type: 'string', description: 'registry 基础地址（默认 https://registry.npmjs.org/）' },
      token: { type: 'string', description: 'npm auth token（可选；发布/查询私有包时使用）' },
      reset: { type: 'boolean', description: '设为 true 清除 registry 与 token 配置' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          registry: { type: 'string' },
          registryConfigured: { type: 'boolean' },
          tokenConfigured: { type: 'boolean' },
          tokenMasked: { type: 'string' },
          configPath: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: { registry?: string; token?: string; reset?: boolean }) {
      const view = await ctx.store.patch(args)
      const parts = []
      if (args.reset === true) parts.push('已清除全部配置')
      else {
        if (args.registry !== undefined) parts.push('registry → ' + view.registry)
        if (args.token !== undefined) parts.push('token ' + (args.token === '' ? '已清除' : '已保存（' + view.tokenMasked + '）'))
        if (args.registry === undefined && args.token === undefined) parts.push('当前 registry：' + view.registry + '；token：' + (view.tokenConfigured ? '已配置（' + view.tokenMasked + '）' : '未配置'))
      }
      return {
        ok: true,
        message: 'dsh-npm：' + parts.join('；') + '。配置存 ' + view.configPath + '（0600）。',
        ...view,
      }
    },
  })
}

/** Tool: package info. */
export function npmInfoTool(ctx: ToolContext) {
  return defineTool({
    name: 'npm_info',
    description: '查询 npm 包信息（registry 元数据）：最新版本、dist-tags、描述、作者、license、homepage、仓库、创建/更新时间、版本总数、最新版依赖摘要。包不存在或网络错误会返回错误信息。',
    parameters: {
      name: { type: 'string', description: '包名（支持 @scope/name）' },
      registry: { type: 'string', description: '可选：本次查询使用的 registry 基础地址，覆盖插件配置' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          name: { type: 'string' },
          description: { type: 'string' },
          latestVersion: { type: 'string' },
          distTags: { type: 'json' },
          versionCount: { type: 'number' },
          license: { type: 'string' },
          author: { type: 'string' },
          homepage: { type: 'string' },
          repository: { type: 'string' },
          keywords: { type: 'array' },
          created: { type: 'string' },
          modified: { type: 'string' },
          // DSH 0.1.5+ validates a tool result against this schema with
          // additionalProperties: false, so every key PackageInfo carries must be
          // declared here or the call fails with "is not a declared property".
          latestDependencies: { type: 'json' },
          latestEngines: { type: 'json' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: { name: string; registry?: string }) {
      if (typeof args.name !== 'string' || args.name.trim() === '') {
        return { ok: false, message: '请提供要查询的包名（name）。' }
      }
      const name = args.name.trim()
      try {
        const info = await getPackage(ctx.store, name, { registry: args.registry })
        const tagLine = Object.entries(info.distTags).map(([tag, v]) => tag + '=' + v).join(', ')
        const depCount = Object.keys(info.latestDependencies).length
        const depLine = depCount > 0
          ? '依赖 ' + depCount + ' 项：' + Object.entries(info.latestDependencies).slice(0, 8).map(([d, r]) => d + '@' + r).join('、') + (depCount > 8 ? ' 等' : '')
          : '无运行时依赖'
        const lines = [
          info.description !== '' ? info.description : '（无描述）',
          '最新版本：' + (info.latestVersion !== '' ? info.latestVersion : '?'),
          tagLine !== '' ? 'dist-tags：' + tagLine : '',
          '版本总数：' + info.versionCount,
          '作者：' + (info.author !== '' ? info.author : '未知'),
          'license：' + (info.license !== '' ? info.license : '未知'),
          '更新时间：' + info.modified + '（创建于 ' + info.created + '）',
          depLine,
          info.homepage !== '' ? '主页：' + info.homepage : '',
          info.repository !== '' ? '仓库：' + info.repository : '',
          info.keywords.length > 0 ? '关键词：' + info.keywords.join('、') : '',
        ].filter((line) => line !== '')
        return {
          ok: true,
          message: 'npm 包「' + name + '」：' + lines.join('；') + '。',
          ...info,
        }
      } catch (error) {
        if (error instanceof NpmRegistryError) {
          return { ok: false, message: 'npm_info 失败：' + error.message }
        }
        return { ok: false, message: 'npm_info 失败：' + (error as Error).message }
      }
    },
  })
}

/** Tool: version list. */
export function npmVersionsTool(ctx: ToolContext) {
  return defineTool({
    name: 'npm_versions',
    description: '列出 npm 包的全部已发布版本及发布时间（按发布时间倒序，最新在前），并给出 dist-tags。用于发布前确认目标版本是否已存在。',
    parameters: {
      name: { type: 'string', description: '包名（支持 @scope/name）' },
      limit: { type: 'number', description: '最多返回的版本数（默认 30，最大 200）' },
      registry: { type: 'string', description: '可选：本次查询使用的 registry 基础地址' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          name: { type: 'string' },
          distTags: { type: 'json' },
          total: { type: 'number' },
          versions: { type: 'array' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: { name: string; limit?: number; registry?: string }) {
      if (typeof args.name !== 'string' || args.name.trim() === '') {
        return { ok: false, message: '请提供要查询的包名（name）。' }
      }
      const name = args.name.trim()
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(200, Math.floor(args.limit))) : 30
      try {
        const { versions, distTags } = await getVersions(ctx.store, name, { registry: args.registry })
        const shown: VersionView[] = versions.slice(0, limit).map((v: VersionEntry) => ({
          version: v.version,
          publishedAt: v.publishedAt,
        }))
        const lines = shown.map((v) => v.version + (v.publishedAt !== '' ? '（' + v.publishedAt.slice(0, 10) + '）' : ''))
        return {
          ok: true,
          message: 'npm 包「' + name + '」共 ' + versions.length + ' 个版本，dist-tags：' +
            Object.entries(distTags).map(([tag, v]) => tag + '=' + v).join(', ') +
            '；最近 ' + shown.length + ' 个：' + lines.join('、') + '。' +
            (versions.some((v) => v.version === (distTags.latest ?? '')) ? '' : '（注意：无 latest 标记）'),
          name,
          distTags,
          total: versions.length,
          versions: shown,
        }
      } catch (error) {
        if (error instanceof NpmRegistryError) {
          return { ok: false, message: 'npm_versions 失败：' + error.message }
        }
        return { ok: false, message: 'npm_versions 失败：' + (error as Error).message }
      }
    },
  })
}

/** Tool: registry search. */
export function npmSearchTool(ctx: ToolContext) {
  return defineTool({
    name: 'npm_search',
    description: '在 npm registry 中搜索包：按相关度返回名称、最新版本、描述、作者、关键词与发布时间。',
    parameters: {
      query: { type: 'string', description: '搜索关键词（支持多词）' },
      size: { type: 'number', description: '返回条数（默认 10，最大 50）' },
      registry: { type: 'string', description: '可选：本次查询使用的 registry 基础地址' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          query: { type: 'string' },
          total: { type: 'number' },
          hits: { type: 'array' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: { query: string; size?: number; registry?: string }) {
      if (typeof args.query !== 'string' || args.query.trim() === '') {
        return { ok: false, message: '请提供搜索关键词（query）。' }
      }
      const query = args.query.trim()
      const size = typeof args.size === 'number' ? Math.max(1, Math.min(50, Math.floor(args.size))) : 10
      try {
        const { hits, total } = await searchPackages(ctx.store, query, size, { registry: args.registry })
        const views: SearchHitView[] = hits.map((hit: SearchHit) => ({
          name: hit.name,
          version: hit.version,
          description: hit.description,
          author: hit.author,
          keywords: hit.keywords,
          date: hit.date,
        }))
        const lines = views.map((hit) =>
          hit.name + '@' + hit.version +
          (hit.description !== '' ? ' — ' + hit.description.slice(0, 60) : '') +
          (hit.author !== '' ? '（' + hit.author + '）' : ''),
        )
        return {
          ok: true,
          message: '搜索「' + query + '」共 ' + total + ' 个结果，前 ' + views.length + ' 个：\n' + lines.join('\n'),
          query,
          total,
          hits: views,
        }
      } catch (error) {
        if (error instanceof NpmRegistryError) {
          return { ok: false, message: 'npm_search 失败：' + error.message }
        }
        return { ok: false, message: 'npm_search 失败：' + (error as Error).message }
      }
    },
  })
}

/** Tool: publish. */
export function npmPublishTool(ctx: ToolContext) {
  return defineTool({
    name: 'npm_publish',
    description: '发布 npm 包（真实执行 npm publish，不可随意撤销）。默认复用本机 ~/.npmrc 的登录凭据；若插件配置了 token 则用其发布。发布前建议先 npm_info / npm_versions 确认版本号不存在；dryRun: true 只做校验不实际上传；force: true 可强制覆盖已发布版本（危险，同名同版本发布后 npm 默认拒绝）。',
    parameters: {
      dir: { type: 'string', description: '包目录（含 package.json；默认当前工作目录）' },
      tag: { type: 'string', description: 'dist-tag（默认 latest）' },
      access: { type: 'string', description: 'scoped 包访问级别：public 或 restricted' },
      otp: { type: 'string', description: '两步验证一次性密码（2FA 账号需要）' },
      registry: { type: 'string', description: '可选：本次发布使用的 registry 基础地址' },
      dryRun: { type: 'boolean', description: 'true 时仅预检（--dry-run），不实际上传' },
      force: { type: 'boolean', description: 'true 时强制覆盖已发布版本（危险，默认 false）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          dryRun: { type: 'boolean' },
          force: { type: 'boolean' },
          published: { type: 'json' },
          output: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: { dir?: string; tag?: string; access?: string; otp?: string; registry?: string; dryRun?: boolean; force?: boolean }) {
      const token = await ctx.store.token()
      const registryHost = await ctx.store.registryHost()
      const result = await publishPackage({
        dir: args.dir,
        tag: args.tag,
        access: args.access,
        otp: args.otp,
        registry: args.registry,
        dryRun: args.dryRun === true,
        force: args.force === true,
        token,
        registryHost,
      })
      const stdoutTrimmed = result.stdout.trim()
      const stderrTrimmed = result.stderr.trim()
      if (result.code === 0) {
        const published = parsePublishedOutput(stdoutTrimmed)
        const label = args.dryRun === true ? '预检通过' : '发布成功'
        const detail = published !== null
          ? '「' + published.name + '@' + published.version + '」' + (published.tag !== '' ? '（tag: ' + published.tag + '）' : '')
          : ''
        return {
          ok: true,
          message: 'npm publish ' + label + ' ' + detail + '。' + (stderrTrimmed !== '' ? '\n提示：' + stderrTrimmed.slice(0, 300) : ''),
          dryRun: args.dryRun === true,
          force: args.force === true,
          published,
          output: (stdoutTrimmed + '\n' + stderrTrimmed).slice(0, 4000),
        }
      }
      const hint = /EPUBLISHCONFLICT/.test(stderrTrimmed)
        ? ' 该版本已存在，如需覆盖请传 force: true（危险操作，请先确认）。'
        : /ENEEDAUTH|EOTP|401|403/.test(stderrTrimmed)
          ? ' 认证失败：请先在本机执行 npm login，或用 npm_config 配置 token。'
          : ''
      return {
        ok: false,
        message: 'npm publish 失败（退出码 ' + result.code + '）：' + (stderrTrimmed.split('\n').pop() ?? '未知错误').slice(0, 400) + hint,
        dryRun: args.dryRun === true,
        force: args.force === true,
        published: null,
        output: (stdoutTrimmed + '\n' + stderrTrimmed).slice(0, 4000),
      }
    },
  })
}

/** Tool: deprecate. */
export function npmDeprecateTool(ctx: ToolContext) {
  return defineTool({
    name: 'npm_deprecate',
    description: '标记 npm 包（或指定版本）为弃用（npm deprecate）：安装时会显示弃用警告。格式：spec 为 包名 或 包名@版本（如 my-pkg 或 my-pkg@1.0.0），message 为弃用说明。该操作会真实写入 registry，请谨慎使用。',
    parameters: {
      spec: { type: 'string', description: '包名或 包名@版本（如 my-pkg、my-pkg@1.0.0）' },
      message: { type: 'string', description: '弃用说明（安装时展示给使用者的文字）' },
      registry: { type: 'string', description: '可选：本次操作使用的 registry 基础地址' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          output: { type: 'string' },
        },
      },
      render: (_args: unknown, value: Record<string, unknown>) => text(String(value.message ?? '')),
    },
    async execute(args: { spec: string; message: string; registry?: string }) {
      if (typeof args.spec !== 'string' || args.spec.trim() === '') {
        return { ok: false, message: '请提供要弃用的包 spec（如 my-pkg 或 my-pkg@1.0.0）。' }
      }
      if (typeof args.message !== 'string' || args.message.trim() === '') {
        return { ok: false, message: '请提供弃用说明（message）。' }
      }
      const token = await ctx.store.token()
      const registryHost = await ctx.store.registryHost()
      const result = await deprecatePackage(args.spec.trim(), deprecateMessage(args.message), {
        registry: args.registry,
        token,
        registryHost,
      })
      const stderrTrimmed = result.stderr.trim()
      if (result.code === 0) {
        return {
          ok: true,
          message: '已标记弃用：' + args.spec.trim() + '（' + deprecateMessage(args.message) + '）。' + (stderrTrimmed !== '' ? ' 提示：' + stderrTrimmed.slice(0, 300) : ''),
          output: (result.stdout + '\n' + stderrTrimmed).slice(0, 2000),
        }
      }
      return {
        ok: false,
        message: 'npm deprecate 失败（退出码 ' + result.code + '）：' + (stderrTrimmed.split('\n').pop() ?? '未知错误').slice(0, 400),
        output: (result.stdout + '\n' + stderrTrimmed).slice(0, 2000),
      }
    },
  })
}

/** Build every tool for the registry. */
export function buildTools(ctx: ToolContext): ToolDefinition[] {
  return [
    npmStatusTool(ctx),
    npmConfigTool(ctx),
    npmInfoTool(ctx),
    npmVersionsTool(ctx),
    npmSearchTool(ctx),
    npmPublishTool(ctx),
    npmDeprecateTool(ctx),
  ]
}

/** Re-export helpers for host consumers and smoke tests. */
export { DEFAULT_REGISTRY, mask }
