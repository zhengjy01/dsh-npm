# dsh-npm

NPM registry management for [DeepSeek Harness](https://github.com/deepseek-ai/dsh): query package info, list versions, search the registry, publish packages, and mark packages deprecated — straight from the agent.

- **Query tools** hit the npm registry JSON API directly (no local npm needed, no auth for public packages).
- **Publish / deprecate** shell out to the local `npm` CLI and reuse your own `~/.npmrc` credentials — or an optional token you configure in the plugin.

## Tools

| Tool | Purpose |
|---|---|
| `npm_status` | Plugin status: effective registry, token presence, local npm CLI availability, config path |
| `npm_config` | Configure registry base URL and/or auth token (stored in `~/.dsh/dsh-npm.json`, mode 0600); `reset: true` clears |
| `npm_info` | Package metadata: latest version, dist-tags, description, author, license, homepage, repository, timestamps, dependency summary |
| `npm_versions` | All published versions with publish dates (dist-tags.latest pinned first) — check before publishing |
| `npm_search` | Registry search by keywords (name, description, author, score) |
| `npm_publish` | Real `npm publish` — supports `dir`, `tag`, `access`, `otp`, `registry`, `dryRun`, `force` |
| `npm_deprecate` | Mark a package/version as deprecated (real registry write, use carefully) |

## Compatibility

Requires **DeepSeek Harness ≥ 0.1.5-rc.1** (declared as `dsh.engines.dsh` in the package manifest, so the DSH plugin marketplace can report it) and is verified against **0.1.5-rc.1**. This build carries the DSH 0.1.5 adaptations: the strict tool-result contract (lossless-JSON snapshot, `additionalProperties: false` schema validation, and `output.render` returning `ContentBlock[]`) plus executable resolution that survives a launchd-started host whose `PATH` is only `/usr/bin:/bin`.

## Install

```bash
# from npm (published package)
dsh plugin --profile web add dsh-npm

# or local development
dsh plugin --profile web add link:/path/to/dsh-npm

# after publishing to GitHub (repo tagged with the `dsh-plugin` topic)
dsh plugin --profile web add github:zhengjy01/dsh-npm
```

Restart the DSH web service afterwards (no hot reload).

## Web settings panel

The plugin ships a **NPM** panel in the web settings page (设置 → NPM):
configure registry/token visually (token is masked, stored at mode 0600),
plus quick package lookup (`npm_info`) and registry search (`npm_search`)
without touching the CLI. Host routes: `/api/dsh-npm/config`, `/api/dsh-npm/info`, `/api/dsh-npm/search` (loopback-only).

## Auth model

- **Querying public packages**: no configuration needed.
- **Publishing**: the `npm publish` subprocess reads your normal `~/.npmrc` (`npm login` once and you are done).
- **Token**: optionally set via `npm_config` (`token=…`); it is stored in `~/.dsh/dsh-npm.json` (mode 0600), injected into publish/deprecate through a **temporary userconfig file** (never on the command line or in logs), and used as a Bearer token for private-package queries. It is never echoed in tool output (masked only).
- **Registry**: defaults to `https://registry.npmjs.org/`; override per-call (`registry` arg) or globally (`npm_config registry=…`) — useful for private registries / mirrors.

## Safety notes

- `npm_publish` really uploads to the registry. Before publishing, check the version does not exist yet with `npm_info` / `npm_versions`, and prefer `dryRun: true` first.
- `force: true` overrides an already-published version (npm blocks it by default) — dangerous.
- `npm_deprecate` writes a permanent deprecation message shown to every installer.

## Development

```bash
pnpm install
pnpm build      # tsc declarations + tsdown bundle → dist/index.mjs
pnpm test       # smoke tests (store round-trip, real registry queries, publish --dry-run)
```

## License

MIT
