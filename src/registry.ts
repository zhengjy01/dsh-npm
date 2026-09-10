/**
 * dsh-npm — npm registry HTTP client.
 *
 * Read-only registry queries (package metadata, version list, search) via
 * the public npm registry JSON API. Optional Bearer token from the store
 * enables private-package lookups. Every function resolves to plain
 * JSON-safe data; errors are normalized into friendly messages.
 */

import type { NpmStore } from './store.ts'
import { normalizeRegistry } from './store.ts'

/** Request timeout for registry calls (ms). */
const TIMEOUT_MS = 15_000

/** Error raised for registry-level failures (not found, network, auth…). */
export class NpmRegistryError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message)
    this.name = 'NpmRegistryError'
  }
}

/** JSON-safe registry metadata view for one package. */
export interface PackageInfo {
  name: string
  description: string
  latestVersion: string
  distTags: Record<string, string>
  versionCount: number
  license: string
  author: string
  homepage: string
  repository: string
  keywords: string[]
  created: string
  modified: string
  /** Dependency summary of the latest version (name → range). */
  latestDependencies: Record<string, string>
  /** Engines of the latest version (name → range). */
  latestEngines: Record<string, string>
}

/** One version entry with publish time. */
export interface VersionEntry {
  version: string
  /** ISO publish timestamp ('' when unknown). */
  publishedAt: string
}

/** One search hit. */
export interface SearchHit {
  name: string
  version: string
  description: string
  author: string
  keywords: string[]
  /** ISO publish date of that version. */
  date: string
  searchScore: number
}

/** Registry query options (auth token + explicit registry override). */
export interface RegistryOptions {
  /** Explicit registry override for this call. */
  registry?: string
  token?: string
}

/**
 * Normalize a package name into the registry's URL path segment. Scoped
 * names (@scope/name) must be encoded as a whole (@scope%2fname).
 */
export function packagePath(name: string): string {
  return encodeURIComponent(name).replace(/%2F/gi, '/').replace(/%2f/gi, '/')
}

/** Build the full metadata URL for a package. */
export function packageUrl(base: string, name: string): string {
  return base + packagePath(name)
}

/** One registry fetch with auth, timeout, and error normalization. */
async function fetchJson(url: string, token: string | undefined): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: token !== undefined && token !== ''
        ? { Authorization: 'Bearer ' + token, Accept: 'application/json' }
        : { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    const cause = error as Error
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError') {
      throw new NpmRegistryError('请求超时（' + TIMEOUT_MS + 'ms）：' + url)
    }
    throw new NpmRegistryError('网络错误：' + cause.message)
  }
  if (response.status === 404) {
    throw new NpmRegistryError('包不存在（404）：' + url)
  }
  if (response.status === 401 || response.status === 403) {
    throw new NpmRegistryError(
      'registry 认证失败（' + response.status + '）：' + url + '。可能是私有包需要配置 token（npm_config token=…）或 token 无效。',
      response.status,
    )
  }
  if (!response.ok) {
    throw new NpmRegistryError('registry 请求失败（HTTP ' + response.status + '）：' + url, response.status)
  }
  try {
    return await response.json()
  } catch {
    throw new NpmRegistryError('registry 返回了无法解析的内容：' + url)
  }
}

/** Resolve effective registry base for a call. */
export async function resolveRegistry(store: NpmStore, explicit?: string): Promise<string> {
  if (explicit !== undefined && explicit.trim() !== '') return normalizeRegistry(explicit)
  return store.registry()
}

/** Resolve token for a call (explicit beats store). */
export async function resolveToken(store: NpmStore, explicit?: string): Promise<string> {
  if (explicit !== undefined && explicit !== '') return explicit
  return store.token()
}

/** Typed view of the raw registry metadata. */
function viewOf(raw: Record<string, unknown>, name: string): PackageInfo {
  const versions = (raw.versions ?? {}) as Record<string, Record<string, unknown>>
  const distTags = (raw['dist-tags'] ?? {}) as Record<string, string>
  const time = (raw.time ?? {}) as Record<string, string>
  const latest = versions[distTags.latest ?? ''] ?? {}
  const latestDependencies = (latest.dependencies ?? {}) as Record<string, string>
  const latestEngines = (latest.engines ?? {}) as Record<string, string>
  const keywords = (raw.keywords ?? []) as string[]
  const authorRaw = raw.author as Record<string, unknown> | string | undefined
  const repositoryRaw = raw.repository as Record<string, unknown> | string | undefined
  return {
    name: String(raw.name ?? name),
    description: typeof raw.description === 'string' ? raw.description : '',
    latestVersion: distTags.latest ?? '',
    distTags,
    versionCount: Object.keys(versions).length,
    license: typeof latest.license === 'string' ? latest.license : typeof raw.license === 'string' ? raw.license : '',
    author: typeof authorRaw === 'string' ? authorRaw : typeof authorRaw?.name === 'string' ? String(authorRaw.name) : '',
    homepage: typeof raw.homepage === 'string' ? raw.homepage : '',
    repository: typeof repositoryRaw === 'string' ? repositoryRaw : typeof repositoryRaw?.url === 'string' ? String(repositoryRaw.url) : '',
    keywords: Array.isArray(keywords) ? keywords.slice(0, 20) : [],
    created: time.created ?? '',
    modified: time.modified ?? '',
    latestDependencies,
    latestEngines,
  }
}

/** Fetch full package metadata. Throws NpmRegistryError on 404/network. */
export async function getPackage(store: NpmStore, name: string, options: RegistryOptions = {}): Promise<PackageInfo> {
  const base = await resolveRegistry(store, options.registry)
  const token = await resolveToken(store, options.token)
  const raw = await fetchJson(packageUrl(base, name), token)
  return viewOf(raw as Record<string, unknown>, name)
}

/** List every published version with its publish time (latest tag first). */
export async function getVersions(store: NpmStore, name: string, options: RegistryOptions = {}): Promise<{ versions: VersionEntry[]; distTags: Record<string, string>; name: string }> {
  const base = await resolveRegistry(store, options.registry)
  const token = await resolveToken(store, options.token)
  const raw = (await fetchJson(packageUrl(base, name), token)) as Record<string, unknown>
  const versionsRaw = (raw.versions ?? {}) as Record<string, Record<string, unknown>>
  const time = (raw.time ?? {}) as Record<string, string>
  const distTags = (raw['dist-tags'] ?? {}) as Record<string, string>
  const latest = distTags.latest ?? ''
  const versions: VersionEntry[] = Object.keys(versionsRaw)
    .map((version) => ({ version, publishedAt: time[version] ?? '' }))
    .sort((a, b) => {
      // Pin the dist-tags.latest version to the top, then sort the rest by
      // publish time (newest first) — the latest tag is not always the most
      // recently published version.
      if (a.version === latest) return -1
      if (b.version === latest) return 1
      const aTime = a.publishedAt !== '' ? new Date(a.publishedAt).getTime() : 0
      const bTime = b.publishedAt !== '' ? new Date(b.publishedAt).getTime() : 0
      if (aTime !== bTime) return bTime - aTime
      return b.version.localeCompare(a.version)
    })
  return { versions, distTags, name: String(raw.name ?? name) }
}

/** Search packages on the registry. Throws NpmRegistryError on failure. */
export async function searchPackages(
  store: NpmStore,
  query: string,
  size: number,
  options: RegistryOptions = {},
): Promise<{ hits: SearchHit[]; total: number }> {
  const base = await resolveRegistry(store, options.registry)
  const token = await resolveToken(store, options.token)
  const url = base + '-/v1/search?text=' + encodeURIComponent(query) + '&size=' + Math.max(1, Math.min(50, Math.floor(size)))
  const raw = (await fetchJson(url, token)) as Record<string, unknown>
  const objects = (raw.objects ?? []) as Array<Record<string, unknown>>
  const hits: SearchHit[] = objects.map((object) => {
    const pkg = (object.package ?? {}) as Record<string, unknown>
    const authorRaw = pkg.author as Record<string, unknown> | string | undefined
    return {
      name: String(pkg.name ?? ''),
      version: String(pkg.version ?? ''),
      description: typeof pkg.description === 'string' ? pkg.description : '',
      author: typeof authorRaw === 'string' ? authorRaw : typeof authorRaw?.name === 'string' ? String(authorRaw.name) : '',
      keywords: Array.isArray(pkg.keywords) ? (pkg.keywords as string[]).slice(0, 10) : [],
      date: typeof pkg.date === 'string' ? pkg.date : '',
      searchScore: typeof object.searchScore === 'number' ? object.searchScore : 0,
    }
  })
  return { hits, total: typeof raw.total === 'number' ? raw.total : hits.length }
}
