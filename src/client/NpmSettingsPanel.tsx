/**
 * NPM settings panel — rendered inside the web settings page
 * (settings.section entry). Connection setup (registry URL, auth token
 * with masked echo), quick package lookup (latest version, description,
 * timestamps), and registry search. Plain React, inline styles only.
 */
import { useCallback, useEffect, useState } from 'react'
import { NpmApi, type NpmConfigView, type NpmPackageInfo, type NpmSearchHit } from './api.ts'

/** Module-level API client (stateless; the component closes over it). */
const api = new NpmApi()

/** One shared style sheet (kept tiny and theme-agnostic). */
const s = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxWidth: '620px',
    padding: '14px 16px',
    borderRadius: '10px',
    border: '1px solid rgba(128,128,128,0.3)',
    fontSize: '13px',
    color: 'inherit',
  } as const,
  title: { fontWeight: 600, fontSize: '13px', margin: 0 } as const,
  status: { fontSize: '12px', opacity: 0.85 } as const,
  statusWarn: { fontSize: '12px', opacity: 0.9, color: '#c9763a' } as const,
  row: { display: 'flex', gap: '6px', alignItems: 'center' } as const,
  input: {
    width: '100%',
    boxSizing: 'border-box',
    padding: '5px 8px',
    borderRadius: '6px',
    border: '1px solid rgba(128,128,128,0.35)',
    background: 'rgba(128,128,128,0.08)',
    color: 'inherit',
    fontSize: '12px',
  } as const,
  button: {
    padding: '4px 10px',
    borderRadius: '6px',
    cursor: 'pointer',
    border: '1px solid rgba(128,128,128,0.4)',
    background: 'rgba(128,128,128,0.14)',
    color: 'inherit',
    fontSize: '12px',
    whiteSpace: 'nowrap',
  } as const,
  flex: { flex: 1 } as const,
  msg: { fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', opacity: 0.9 } as const,
  hint: { fontSize: '11px', opacity: 0.75, lineHeight: 1.6 } as const,
  hitRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'baseline',
    fontSize: '12px',
    padding: '3px 0',
    borderBottom: '1px solid rgba(128,128,128,0.12)',
  } as const,
  hitName: { fontWeight: 600, whiteSpace: 'nowrap' } as const,
  hitDesc: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const,
  hitMeta: { opacity: 0.7, fontSize: '11px', whiteSpace: 'nowrap' } as const,
} as const

/** Status line for the current config view. */
function statusText(view: NpmConfigView | null): string {
  if (view === null) return '加载中…'
  const parts = [
    'registry：' + view.registry + (view.registryConfigured ? '（已配置）' : '（默认）'),
    'token：' + (view.tokenConfigured ? '已配置（' + view.tokenMasked + '）' : '未配置'),
  ]
  return parts.join(' · ')
}

/** Short date label (YYYY-MM-DD). */
function dateLabel(value: string): string {
  if (value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().slice(0, 10)
}

/** The settings panel component. */
export function NpmSettingsPanel(): JSX.Element {
  const [view, setView] = useState<NpmConfigView | null>(null)
  const [registry, setRegistry] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Quick lookup state.
  const [lookupName, setLookupName] = useState('')
  const [lookup, setLookup] = useState<NpmPackageInfo | null>(null)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupMsg, setLookupMsg] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<NpmSearchHit[]>([])
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchMsg, setSearchMsg] = useState('')

  const refreshConfig = useCallback(async () => {
    try {
      const next = await api.getConfig()
      setView(next)
      setRegistry(next.registry)
    } catch (error) {
      setMsg('读取配置失败: ' + String(error instanceof Error ? error.message : error))
    }
  }, [])

  useEffect(() => { void refreshConfig() }, [refreshConfig])

  /** Run one async panel action with busy/message bookkeeping. */
  const run = async (action: () => Promise<string | void>): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const message = await action()
      if (message !== undefined) setMsg(message)
    } catch (error) {
      setMsg('操作失败: ' + String(error instanceof Error ? error.message : error))
    } finally {
      setBusy(false)
    }
  }

  const save = (): void => {
    void run(async () => {
      const next = await api.setConfig({ registry, token })
      setView(next)
      setToken('')
      return next.configured
        ? '已保存：registry → ' + next.registry + '；token ' + (next.tokenConfigured ? '已配置（' + next.tokenMasked + '）' : '未配置') + '。'
        : '配置已保存（为空）。'
    })
  }

  const clear = (): void => {
    void run(async () => {
      const next = await api.setConfig({ reset: true })
      setView(next)
      setRegistry('')
      setToken('')
      return 'registry 与 token 已清除。'
    })
  }

  const doLookup = (): void => {
    const name = lookupName.trim()
    if (name === '') return
    setLookupBusy(true)
    setLookupMsg('')
    void api.info(name).then((result) => {
      if (result.ok && result.info !== undefined) {
        setLookup(result.info)
      } else {
        setLookup(null)
        setLookupMsg(result.error ?? '查询失败')
      }
    }).catch((error: unknown) => {
      setLookup(null)
      setLookupMsg(String(error instanceof Error ? error.message : error))
    }).finally(() => setLookupBusy(false))
  }

  const doSearch = (): void => {
    const q = query.trim()
    if (q === '') return
    setSearchBusy(true)
    setSearchMsg('')
    void api.search(q, 8).then((result) => {
      if (result.ok) {
        setHits(result.hits ?? [])
        setSearchTotal(result.total ?? 0)
      } else {
        setHits([])
        setSearchTotal(0)
        setSearchMsg(result.error ?? '搜索失败')
      }
    }).catch((error: unknown) => {
      setHits([])
      setSearchTotal(0)
      setSearchMsg(String(error instanceof Error ? error.message : error))
    }).finally(() => setSearchBusy(false))
  }

  return (
    <div style={s.card}>
      <p style={s.title}>NPM</p>
      <div style={view !== null && view.tokenConfigured ? s.status : s.statusWarn}>{statusText(view)}</div>
      <div style={s.hint}>
        登录方式：① 在终端执行 <code>npm login</code>（凭据写入 ~/.npmrc，发布自动复用）；② 在 npmjs.com 生成
        Publish token 填到下方（存 ~/.dsh/dsh-npm.json，权限 0600，不回显完整 token）。token 有有效期，过期后重新生成即可。
      </div>

      <input
        style={s.input}
        placeholder="registry（默认 https://registry.npmjs.org/，如 https://registry.npmmirror.com）"
        value={registry}
        onChange={(event) => setRegistry(event.target.value)}
      />
      <input
        style={s.input}
        type="password"
        placeholder={'token（' + (view !== null && view.tokenConfigured ? '已配置，留空保持不变' : 'npm_xxx…') + '）'}
        value={token}
        onChange={(event) => setToken(event.target.value)}
      />

      <div style={s.row}>
        <button style={s.button} onClick={save} disabled={busy}>保存</button>
        <button style={s.button} onClick={clear} disabled={busy || !(view !== null && view.configured)}>清除</button>
      </div>

      <div style={{ height: '1px', background: 'rgba(128,128,128,0.2)', margin: '2px 0' }} />

      <div style={s.hint}>快捷查包（等价于 npm_info）：</div>
      <div style={s.row}>
        <input
          style={{ ...s.input, ...s.flex }}
          placeholder="包名，如 express"
          value={lookupName}
          onChange={(event) => setLookupName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') doLookup() }}
        />
        <button style={s.button} onClick={doLookup} disabled={lookupBusy || lookupName.trim() === ''}>查询</button>
      </div>
      {lookup !== null && (
        <div style={s.hint}>
          <b>{lookup.name}</b>@{lookup.latestVersion} · 共 {lookup.versionCount} 个版本
          {lookup.description !== '' && <> — {lookup.description}</>}
          {'\n'}作者 {lookup.author || '未知'} · license {lookup.license || '未知'} · 更新于 {dateLabel(lookup.modified)}
          {lookup.homepage !== '' && <> · 主页 {lookup.homepage}</>}
        </div>
      )}
      {lookupMsg !== '' && <div style={s.msg}>{lookupMsg}</div>}

      <div style={s.hint}>快捷搜索（等价于 npm_search）：</div>
      <div style={s.row}>
        <input
          style={{ ...s.input, ...s.flex }}
          placeholder="关键词，如 react hooks"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') doSearch() }}
        />
        <button style={s.button} onClick={doSearch} disabled={searchBusy || query.trim() === ''}>搜索</button>
      </div>
      {hits.length > 0 && (
        <>
          <div style={s.hint}>前 {hits.length} 个结果（共 {searchTotal}）：</div>
          <div>
            {hits.map((hit) => (
              <div key={hit.name} style={s.hitRow}>
                <span style={s.hitName}>{hit.name}@{hit.version}</span>
                <span style={s.hitDesc} title={hit.description}>{hit.description}</span>
                <span style={s.hitMeta}>{hit.author}{hit.date !== '' && ' · ' + dateLabel(hit.date)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {searchMsg !== '' && <div style={s.msg}>{searchMsg}</div>}

      {msg !== '' && <div style={s.msg}>{msg}</div>}
    </div>
  )
}
