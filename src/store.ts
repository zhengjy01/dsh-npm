/**
 * dsh-npm — credential/registry store.
 *
 * Persists the npm registry override and (optional) auth token to
 * ~/.dsh/dsh-npm.json (mode 0600). Reads are lazy and cached; the public
 * view() never exposes the token. The config path can be overridden with
 * DSH_NPM_CONFIG (used by the smoke tests).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

/** Default machine-wide config location (mode 0600). */
export const DEFAULT_CONFIG_FILE = path.join(homedir(), '.dsh', 'dsh-npm.json')

/** Default registry when none is configured. */
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'

/** Test override for the config location. */
export function configPath(): string {
  const override = process.env.DSH_NPM_CONFIG
  return override !== undefined && override !== '' ? override : DEFAULT_CONFIG_FILE
}

/** Persisted configuration shape. The token never leaves this module. */
export interface NpmConfig {
  /** Registry base URL ('' means DEFAULT_REGISTRY). */
  registry: string
  /** Optional npm auth token for private packages / publishing. */
  token: string
}

/** Public, secret-free status view. */
export interface NpmConfigView {
  configured: boolean
  /** Effective registry base URL (configured or default). */
  registry: string
  /** Whether the registry was explicitly configured (vs default). */
  registryConfigured: boolean
  /** Whether an auth token is present. */
  tokenConfigured: boolean
  tokenMasked: string
  configPath: string
}

/** Mask a credential for display, keeping only the head and tail. */
export function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return value.slice(0, 2) + '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

/** Empty config record. */
function empty(): NpmConfig {
  return { registry: '', token: '' }
}

/**
 * Registry credential/token store with lazy cached reads and masked views.
 */
export class NpmStore {
  private cached: NpmConfig | null = null

  /** Current file path (honors the DSH_NPM_CONFIG override). */
  readonly file: string = configPath()

  /** Read the config (lazy, cached). */
  async read(): Promise<NpmConfig> {
    if (this.cached !== null) return this.cached
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      const obj = (parsed ?? {}) as Record<string, unknown>
      this.cached = {
        registry: typeof obj.registry === 'string' ? obj.registry : '',
        token: typeof obj.token === 'string' ? obj.token : '',
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cached = empty()
      } else {
        // Corrupt config: fall back to empty rather than crashing the plugin.
        this.cached = empty()
      }
    }
    return this.cached
  }

  /** Effective registry base URL (configured or default). */
  async registry(): Promise<string> {
    const config = await this.read()
    return normalizeRegistry(config.registry || DEFAULT_REGISTRY)
  }

  /** Whether an auth token is present. */
  async token(): Promise<string> {
    const config = await this.read()
    return config.token
  }

  /** Effective registry host (for building npm userconfig auth lines). */
  async registryHost(): Promise<string> {
    const url = new URL(await this.registry())
    return url.host
  }

  /** Persist a patch (registry/token) or clear everything with reset. */
  async patch(patch: { registry?: string; token?: string; reset?: boolean }): Promise<NpmConfigView> {
    const current = await this.read()
    let next: NpmConfig
    if (patch.reset === true) {
      next = empty()
    } else {
      next = {
        registry: patch.registry !== undefined ? normalizeRegistry(patch.registry) : current.registry,
        token: patch.token !== undefined ? patch.token : current.token,
      }
    }
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
    this.cached = next
    return this.view()
  }

  /** Public secret-free view. */
  async view(): Promise<NpmConfigView> {
    const config = await this.read()
    const registry = normalizeRegistry(config.registry || DEFAULT_REGISTRY)
    return {
      configured: config.registry !== '' || config.token !== '',
      registry,
      registryConfigured: config.registry !== '',
      tokenConfigured: config.token !== '',
      tokenMasked: mask(config.token),
      configPath: this.file,
    }
  }
}

/** Normalize a registry URL to a trailing-slash base URL. */
export function normalizeRegistry(registry: string): string {
  const trimmed = registry.trim()
  if (trimmed === '') return DEFAULT_REGISTRY
  const withSlash = trimmed.endsWith('/') ? trimmed : trimmed + '/'
  // Accept bare hosts like "registry.npmjs.org" or "npm.example.com".
  if (!/^https?:\/\//.test(withSlash)) return 'https://' + withSlash
  return withSlash
}
