/**
 * Browser-side API client for the /api/dsh-npm route family. The only
 * data access path the settings panel uses — plain fetch, same origin.
 */

/** Public config view (mirrors the host contract). */
export interface NpmConfigView {
  configured: boolean
  registry: string
  registryConfigured: boolean
  tokenConfigured: boolean
  tokenMasked: string
  configPath: string
}

/** Package info (panel view). */
export interface NpmPackageInfo {
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
  latestDependencies: Record<string, string>
  latestEngines: Record<string, string>
}

/** One search hit (panel view). */
export interface NpmSearchHit {
  name: string
  version: string
  description: string
  author: string
  keywords: string[]
  date: string
  searchScore: number
}

/** Error carrying the route's JSON error message. */
export class NpmApiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NpmApiError'
  }
}

/** Parse a JSON response or throw an NpmApiError. */
async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new NpmApiError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new NpmApiError(message)
  }
  return body as T
}

/** Plain fetch helper with an error wrapper. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    throw new NpmApiError('网络请求失败: ' + String(error instanceof Error ? error.message : error))
  }
  return readJson<T>(response)
}

/** The npm panel API. */
export class NpmApi {
  async getConfig(): Promise<NpmConfigView> {
    return request<NpmConfigView>('/api/dsh-npm/config')
  }

  async setConfig(patch: Record<string, unknown>): Promise<NpmConfigView> {
    return request<NpmConfigView>('/api/dsh-npm/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
  }

  async info(name: string, registry?: string): Promise<{ ok: boolean; info?: NpmPackageInfo; error?: string }> {
    const params = new URLSearchParams({ name })
    if (registry !== undefined && registry !== '') params.set('registry', registry)
    return request('/api/dsh-npm/info?' + params.toString())
  }

  async search(query: string, size?: number, registry?: string): Promise<{ ok: boolean; total?: number; hits?: NpmSearchHit[]; error?: string }> {
    const params = new URLSearchParams({ q: query })
    if (size !== undefined) params.set('size', String(size))
    if (registry !== undefined && registry !== '') params.set('registry', registry)
    return request('/api/dsh-npm/search?' + params.toString())
  }
}
