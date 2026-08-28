import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UniGetUiApi, UniGetUiPage, UniGetUiStatus, UniGetUiUniverseState } from '@shared/unigetui'
import { UNIGETUI_DEFAULT_UNIVERSE_STATE, UNIGETUI_PAGES } from '@shared/unigetui'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { MaterialSymbol } from '../MaterialSymbol'
import { Progress, Tabs } from '../../ui/md3'

export interface UniGetUiUniversePanelProps { onClose: () => void }

const PAGE_LABELS: Record<UniGetUiPage, string> = {
  overview: 'Overview', discover: 'Discover', installed: 'Installed', updates: 'Updates', operations: 'Operations',
  managers: 'Managers', sources: 'Sources', bundles: 'Bundles', settings: 'Settings', shortcuts: 'Shortcuts',
  logs: 'Logs', backups: 'Backups', help: 'Help'
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['items', 'results', 'operations', 'packages', 'sources', 'managers', 'entries']) {
      if (Array.isArray(record[key])) return asRows(record[key])
    }
  }
  return []
}

function rowText(row: Record<string, unknown>): string {
  return Object.values(row).filter((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean').join(' ')
}

export function UniGetUiUniversePanel({ onClose }: UniGetUiUniversePanelProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const api = window.nodeTerminal.unigetui
  const [status, setStatus] = useState<UniGetUiStatus | null>(null)
  const [state, setState] = useState<UniGetUiUniverseState>(UNIGETUI_DEFAULT_UNIVERSE_STATE)
  const [page, setPage] = useState<UniGetUiPage>('overview')
  const [payload, setPayload] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([api.status(), api.universeState()]).then(([nextStatus, nextState]) => {
      if (cancelled) return
      setStatus(nextStatus)
      setState(nextState)
      setPage(nextState.selectedPage)
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [api])

  const load = useCallback(async (target: UniGetUiPage) => {
    setPage(target)
    setPayload(null)
    setError(null)
    setBusy(true)
    try {
      let value: unknown
      if (target === 'overview') value = await api.appStatus()
      else if (target === 'discover') value = await api.packageSearch(search.value || 'all', undefined, 100)
      else if (target === 'installed') value = await api.packageInstalled()
      else if (target === 'updates') value = await api.packageUpdates()
      else if (target === 'operations') value = await api.operations()
      else if (target === 'managers') value = await api.managers()
      else if (target === 'sources') value = await api.sources()
      else if (target === 'bundles') value = await api.bundle()
      else if (target === 'settings') value = await api.settings()
      else if (target === 'shortcuts') value = await api.shortcuts()
      else if (target === 'logs') value = await api.logs('app')
      else if (target === 'backups') value = await api.backups()
      else value = { message: 'UniGetUI public CLI help is available through the bundled documentation.' }
      setPayload(value)
      const next = { ...state, selectedPage: target, search: search.value, regexEnabled: search.mode === 'regex', regexPattern: search.pattern, regexFlags: search.flags }
      setState(await api.saveUniverseState(next))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }, [api, search.flags, search.mode, search.pattern, search.value, state])

  const rows = useMemo(() => asRows(payload).filter((row) => search.test(rowText(row))), [payload, search])
  const isUnavailable = status && status.health !== 'ok'

  return (
    <aside className="drawer unigetui-universe" role="dialog" aria-label={vocab('UniGetUI Global Universe')}>
      <header className="unigetui-universe__header">
        <div>
          <h2><MaterialSymbol name="hub" size={22} /> {vocab('UniGetUI Global Universe')}</h2>
          <p>{vocab('One machine-owned package workspace. Its state is independent of the active project.')}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={vocab('Close UniGetUI Global Universe')}><MaterialSymbol name="close" size={20} /></button>
      </header>
      <div className="unigetui-universe__search">
        <label htmlFor="unigetui-universe-search">{vocab('Search this UniGetUI page')}</label>
        <div className="unigetui-universe__search-row">
          <input ref={searchRef} id="unigetui-universe-search" type="search" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={vocab('Search packages, operations, or settings')} />
          <AnchoredRegexBuilder search={search} fieldRef={searchRef} label={vocab('Open regex builder for this UniGetUI page')} />
          <button type="button" onClick={() => void load(page)} disabled={busy} aria-label={vocab('Refresh UniGetUI page')}><MaterialSymbol name="refresh" size={18} /></button>
        </div>
        <span role="status">{search.error ?? vocab(`${rows.length} entries shown`)}</span>
      </div>
      <Tabs
        ariaLabel={vocab('UniGetUI Global Universe sections')}
        value={page}
        onChange={(value) => void load(value as UniGetUiPage)}
        items={UNIGETUI_PAGES.map((item) => ({ id: item, label: PAGE_LABELS[item] }))}
      />
      {status && (
        <section className={`unigetui-universe__status unigetui-universe__status--${status.health}`} aria-live="polite">
          <strong>{status.health === 'ok' ? '✅' : '⚠️'} {vocab(status.health)}</strong>
          <span>{status.detail ?? (status.version ? `${vocab('Version')} ${status.version}` : vocab('No active UniGetUI session was detected.'))}</span>
        </section>
      )}
      {busy && <Progress value={null} label={vocab('Loading UniGetUI data')} />}
      {error && <p className="unigetui-universe__error" role="alert">{vocab('UniGetUI could not complete this request')}: {error}</p>}
      {isUnavailable && !busy && <p className="unigetui-universe__empty">{vocab('This Global Universe is unavailable until UniGetUI is installed and its local automation session is running.')}</p>}
      {!isUnavailable && !busy && page === 'discover' && <DiscoverActions api={api} rows={rows} vocab={vocab} />}
      {!isUnavailable && !busy && page !== 'discover' && rows.length > 0 && <DataRows rows={rows} />}
      {!isUnavailable && !busy && page !== 'discover' && rows.length === 0 && <pre className="unigetui-universe__empty">{payload ? JSON.stringify(payload, null, 2) : vocab('No data was returned for this section.')}</pre>}
      {page === 'help' && <p className="unigetui-universe__help">{vocab('Package actions are delegated to UniGetUI through its public local automation interface. Credentials and manager state stay with UniGetUI.')} </p>}
    </aside>
  )
}

function DiscoverActions({ api, rows, vocab }: { api: UniGetUiApi; rows: Array<Record<string, unknown>>; vocab: (value: string, vars?: Record<string, string>) => string }): React.JSX.Element {
  return <ul className="unigetui-universe__rows">{rows.map((row, index) => { const id = typeof row.id === 'string' ? row.id : typeof row.packageId === 'string' ? row.packageId : ''; return <li key={`${id}-${index}`}><span>{rowText(row) || vocab('Unnamed package')}</span><button type="button" disabled={!id} onClick={() => void api.packageInstall(id, { wait: false })}>{vocab('Install')}</button><button type="button" disabled={!id} onClick={() => void api.packageDownload(id, { wait: false })}>{vocab('Download')}</button></li> })}</ul>
}

function DataRows({ rows }: { rows: Array<Record<string, unknown>> }): React.JSX.Element {
  return <ul className="unigetui-universe__rows">{rows.map((row, index) => <li key={index}><pre>{JSON.stringify(row, null, 2)}</pre></li>)}</ul>
}
