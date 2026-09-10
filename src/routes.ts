/**
 * dsh-npm — loopback HTTP routes for the web settings panel.
 *
 * Route family: /api/dsh-npm/*. All routes are loopback-only
 * (127.0.0.1/localhost, same-origin). The panel reads/writes the config
 * (registry/token) and runs quick package lookups through the same
 * registry client the tools use.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NpmStore } from './store.ts'
import type { RegistryOptions } from './registry.ts'
import { getPackage, searchPackages, NpmRegistryError } from './registry.ts'

/** Route paths. */
export const NPM_API = {
  config: '/api/dsh-npm/config',
  info: '/api/dsh-npm/info',
  search: '/api/dsh-npm/search',
} as const

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 256 * 1024

/** Strict loopback fence for every route (the panel is same-origin only). */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read and parse a JSON request body (undefined when invalid). */
async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Route dependencies. */
export interface RouteContext {
  store: NpmStore
}

/** Build the route list for ctx.webServer.register. */
export function makeRoutes(deps: RouteContext) {
  const { store } = deps

  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  /** Read query params as a string map. */
  const queryOf = (req: IncomingMessage): URLSearchParams => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    return url.searchParams
  }

  return [
    {
      kind: 'exact' as const,
      path: NPM_API.config,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const method = req.method ?? 'GET'
        if (method === 'GET') {
          if (!guard(req, res, 'GET')) return
          writeJson(res, 200, await store.view())
          return
        }
        if (method === 'POST') {
          if (!guard(req, res, 'POST')) return
          const body = await readJsonBody(req)
          if (body === undefined) {
            writeJson(res, 400, { error: 'invalid JSON body' })
            return
          }
          writeJson(res, 200, await store.patch(body))
          return
        }
        writeJson(res, 405, { error: `method not allowed: ${method}` })
      },
    },
    {
      kind: 'exact' as const,
      path: NPM_API.info,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        const params = queryOf(req)
        const name = (params.get('name') ?? '').trim()
        if (name === '') {
          writeJson(res, 400, { ok: false, error: 'missing name' })
          return
        }
        const options: RegistryOptions = {}
        const registry = (params.get('registry') ?? '').trim()
        if (registry !== '') options.registry = registry
        try {
          const info = await getPackage(store, name, options)
          writeJson(res, 200, { ok: true, info })
        } catch (error) {
          writeJson(res, 200, {
            ok: false,
            error: error instanceof NpmRegistryError ? error.message : (error as Error).message,
          })
        }
      },
    },
    {
      kind: 'exact' as const,
      path: NPM_API.search,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        const params = queryOf(req)
        const query = (params.get('q') ?? '').trim()
        if (query === '') {
          writeJson(res, 400, { ok: false, error: 'missing q' })
          return
        }
        const sizeRaw = Number(params.get('size') ?? '10')
        const size = Number.isFinite(sizeRaw) ? Math.max(1, Math.min(50, Math.floor(sizeRaw))) : 10
        const options: RegistryOptions = {}
        const registry = (params.get('registry') ?? '').trim()
        if (registry !== '') options.registry = registry
        try {
          const { hits, total } = await searchPackages(store, query, size, options)
          writeJson(res, 200, { ok: true, total, hits })
        } catch (error) {
          writeJson(res, 200, {
            ok: false,
            error: error instanceof NpmRegistryError ? error.message : (error as Error).message,
          })
        }
      },
    },
  ]
}
