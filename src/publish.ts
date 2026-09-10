/**
 * dsh-npm — npm CLI wrapper for publish / deprecate.
 *
 * Runs the local `npm` executable. Authentication reuses the user's own
 * ~/.npmrc by default; when the plugin store holds a token, it is injected
 * through a temporary --userconfig file (mode 0600, removed after the run)
 * so the token never appears on the command line or in logs.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'

/** Default timeout for npm CLI runs (ms) — publishing uploads can be slow. */
const DEFAULT_TIMEOUT_MS = 180_000

/**
 * Well-known directories that hold a package manager on this machine.
 *
 * DSH can be launched by launchd (the shipped `com.dsh.web` service), whose
 * PATH is only `/usr/bin:/bin`. A bare `npm` then dies with ENOENT even though
 * it is installed, so every lookup also probes these absolute locations.
 */
function extraBinDirs(): string[] {
  const home = homedir()
  const dirs = [
    path.join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.bun', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/bin',
    '/bin',
  ]
  // Node version managers keep each release under its own bin directory.
  for (const manager of ['.nvm/versions/node', '.local/share/fnm/node-versions', '.asdf/installs/nodejs']) {
    const root = path.join(home, manager)
    try {
      for (const entry of readdirSync(root)) dirs.push(path.join(root, entry, 'bin'))
    } catch {
      // Not installed with this manager — nothing to add.
    }
  }
  return dirs
}

/**
 * Resolve an executable name to an absolute path.
 * @param name - bare executable name (without a Windows extension).
 * @returns the first existing absolute path, or the bare name so that the OS
 *   still performs its own PATH lookup (and reports a meaningful error).
 */
export function resolveExecutable(name: string): string {
  const suffixes = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : ['']
  const seen = new Set<string>()
  for (const dir of [...(process.env.PATH ?? '').split(path.delimiter), ...extraBinDirs()]) {
    if (dir === '' || seen.has(dir)) continue
    seen.add(dir)
    for (const suffix of suffixes) {
      const candidate = path.join(dir, name + suffix)
      if (existsSync(candidate)) return candidate
    }
  }
  return name
}

/** npm executable name (Windows needs the .cmd shim). */
function npmBin(): string {
  // The Windows `.cmd` shim is covered by resolveExecutable's suffix list.
  return resolveExecutable('npm')
}

/** Result of one npm CLI invocation. */
export interface NpmRunResult {
  code: number
  stdout: string
  stderr: string
}

/** Environment probe for the status tool. */
export interface NpmEnv {
  available: boolean
  version: string
  /** Absolute path to the npm executable ('' when unavailable). */
  path: string
  node: string
}

/** Probe the local npm installation (fast, synchronous). */
export function npmEnv(): NpmEnv {
  const node = process.version
  try {
    const result = spawnSync(npmBin(), ['--version'], { encoding: 'utf8', timeout: 10_000 })
    if (result.error !== undefined || result.status !== 0) {
      return { available: false, version: '', path: '', node }
    }
    return {
      available: true,
      version: result.stdout.trim().split('\n')[0] ?? '',
      path: result.stdout.includes(npmBin()) ? '' : npmBin(),
      node,
    }
  } catch {
    return { available: false, version: '', path: '', node }
  }
}

/**
 * Run npm with optional token injection via a temporary userconfig.
 * Never throws for non-zero exits — the caller inspects NpmRunResult.
 */
export function runNpm(
  args: string[],
  options: {
    cwd?: string
    timeoutMs?: number
    token?: string
    registryHost?: string
  } = {},
): Promise<NpmRunResult> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    let cleanup: (() => Promise<void>) | undefined
    const finalArgs = [...args]

    const prepare = async (): Promise<void> => {
      if (options.token !== undefined && options.token !== '') {
        const dir = await mkdtemp(path.join(tmpdir(), 'dsh-npm-'))
        const userconfig = path.join(dir, 'npmrc')
        const host = options.registryHost ?? 'registry.npmjs.org'
        // npm 11+ rejects the bare `_authToken` key — the registry-scoped
        // `//host/:_authToken` form covers both scoped and unscoped packages.
        const lines = [
          '//' + host + '/:_authToken=' + options.token,
          '',
        ]
        await writeFile(userconfig, lines.join('\n'), { mode: 0o600 })
        finalArgs.push('--userconfig=' + userconfig)
        cleanup = async () => { await rm(dir, { recursive: true, force: true }) }
      }
    }

    prepare().then(() => {
      const child = spawn(npmBin(), finalArgs, {
        cwd: options.cwd,
        env: { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.on('error', (error) => {
        clearTimeout(timer)
        const message = '无法启动 npm：' + error.message
        void cleanup?.()
        resolve({ code: -1, stdout, stderr: stderr + message })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        void cleanup?.()
        resolve({ code: code ?? -1, stdout, stderr })
      })
    }).catch((error: unknown) => {
      resolve({ code: -1, stdout: '', stderr: '准备 npm 调用失败：' + (error as Error).message })
    })
  })
}

/** Publish options mirroring npm publish flags. */
export interface PublishOptions {
  /** Package directory (default: current working directory). */
  dir?: string
  /** Dist-tag to publish under (default: latest). */
  tag?: string
  /** access=public|restricted for scoped packages. */
  access?: string
  /** One-time password for 2FA-protected accounts. */
  otp?: string
  /** Registry override. */
  registry?: string
  /** Dry run (--dry-run): validate without uploading. */
  dryRun?: boolean
  /** Force-publish an already-published version (dangerous). */
  force?: boolean
  token?: string
  registryHost?: string
  timeoutMs?: number
}

/** Publish a package via `npm publish`. */
export function publishPackage(options: PublishOptions): Promise<NpmRunResult> {
  const args = ['publish']
  if (options.dir !== undefined && options.dir !== '') args.push(options.dir)
  args.push('--json', '--no-fund', '--no-audit')
  if (options.tag !== undefined && options.tag !== '') args.push('--tag', options.tag)
  if (options.access !== undefined && options.access !== '') args.push('--access', options.access)
  if (options.otp !== undefined && options.otp !== '') args.push('--otp', options.otp)
  if (options.registry !== undefined && options.registry !== '') args.push('--registry', options.registry)
  if (options.dryRun === true) args.push('--dry-run')
  if (options.force === true) args.push('--force')
  return runNpm(args, {
    cwd: options.dir !== undefined && options.dir !== '' ? options.dir : undefined,
    timeoutMs: options.timeoutMs,
    token: options.token,
    registryHost: options.registryHost,
  })
}

/** Deprecate a package/version via `npm deprecate`. */
export function deprecatePackage(
  spec: string,
  message: string,
  options: { registry?: string; token?: string; registryHost?: string; timeoutMs?: number } = {},
): Promise<NpmRunResult> {
  const args = ['deprecate', spec, message, '--no-fund', '--no-audit']
  if (options.registry !== undefined && options.registry !== '') args.push('--registry', options.registry)
  return runNpm(args, {
    timeoutMs: options.timeoutMs,
    token: options.token,
    registryHost: options.registryHost,
  })
}
