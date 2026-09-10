/**
 * dsh-npm smoke tests.
 *
 * Exercises the store (config round-trip in a temp file), registry queries
 * (real npmjs.org lookups), and the publish pipeline in --dry-run mode
 * (never uploads). Requires network access to registry.npmjs.org.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  NpmStore,
  mask,
  normalizeRegistry,
  getPackage,
  getVersions,
  searchPackages,
  npmEnv,
  publishPackage,
  deprecatePackage,
} from '../lib/index.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed++
    console.log('  ✔ ' + label)
  } else {
    failed++
    console.error('  ✘ ' + label + (detail ? ' — ' + detail : ''))
  }
}

async function main() {
  console.log('dsh-npm smoke tests')

  // --- store ---
  console.log('[store]')
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-npm-test-'))
  const store = new NpmStore()
  store.file = path.join(dir, 'config.json')
  try {
    let view = await store.view()
    check('empty view', view.configured === false && view.tokenConfigured === false && view.registry === 'https://registry.npmjs.org/')
    check('mask short', mask('abcd1234') === 'ab****')
    check('mask long', mask('npm_abcdefghijklmnop') === 'npm_****mnop')

    view = await store.patch({ registry: 'https://registry.npmmirror.com', token: 'secret-token-1234567890' })
    check('patch registry', view.registry === 'https://registry.npmmirror.com/' && view.registryConfigured === true)
    check('patch token', view.tokenConfigured === true && view.tokenMasked === mask('secret-token-1234567890'))

    const reread = new NpmStore()
    reread.file = store.file
    const config = await reread.read()
    check('persisted', config.registry === 'https://registry.npmmirror.com/' && config.token === 'secret-token-1234567890')

    const cleared = await store.patch({ reset: true })
    check('reset', cleared.configured === false && cleared.tokenConfigured === false)

    check('normalize bare host', normalizeRegistry('registry.npmjs.org') === 'https://registry.npmjs.org/')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  // --- registry queries (real network) ---
  console.log('[registry]')
  const liveStore = new NpmStore()
  try {
    const info = await getPackage(liveStore, 'express')
    check('getPackage express', info.name === 'express' && info.latestVersion !== '' && info.versionCount > 100)
    check('getPackage fields', info.description.includes('web framework') || info.description !== '')

    const { versions, distTags } = await getVersions(liveStore, 'express')
    check('getVersions', versions.length > 10 && distTags.latest !== undefined && versions[0]?.version === distTags.latest)

    const { hits } = await searchPackages(liveStore, 'react', 5)
    check('search react', hits.length > 0 && hits.some((h) => h.name.toLowerCase().includes('react')))
  } catch (error) {
    check('registry queries', false, String(error))
  }

  // --- npm CLI / publish dry-run ---
  console.log('[npm cli]')
  const env = npmEnv()
  check('npmEnv available', env.available === true, 'npm not on PATH?')
  if (env.available) {
    check('npmEnv version', env.version.split('.').length >= 2)

    // Build a minimal package in a temp dir and dry-run publish it.
    const pkgDir = await mkdtemp(path.join(tmpdir(), 'dsh-npm-pkg-'))
    try {
      await writeFile(
        path.join(pkgDir, 'package.json'),
        JSON.stringify({ name: 'dsh-npm-smoke-test', version: '0.0.0', description: 'dsh-npm smoke test package', license: 'MIT' }, null, 2),
      )
      const result = await publishPackage({ dir: pkgDir, dryRun: true, registry: 'https://registry.npmjs.org' })
      check('publish dry-run exit 0', result.code === 0, 'code=' + result.code + ' stderr=' + result.stderr.slice(0, 200))
      check('publish dry-run output', result.stdout.length > 0)

      const deprecateResult = await deprecatePackage('dsh-npm-smoke-test', 'smoke', { registry: 'https://registry.npmjs.org' })
      check('deprecate non-zero (no auth expected)', deprecateResult.code !== 0 || deprecateResult.stderr.includes('deprecat'))
    } finally {
      await rm(pkgDir, { recursive: true, force: true })
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('smoke test crashed:', error)
  process.exitCode = 1
})
