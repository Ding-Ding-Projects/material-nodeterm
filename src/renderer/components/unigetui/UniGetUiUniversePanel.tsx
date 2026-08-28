import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UniGetUiApi, UniGetUiPage, UniGetUiStatus, UniGetUiUniverseState } from '@shared/unigetui'
import { UNIGETUI_DEFAULT_UNIVERSE_STATE, UNIGETUI_PAGES } from '@shared/unigetui'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { MaterialSymbol } from '../MaterialSymbol'
import { Progress, Tabs } from '../../ui/md3'
import { promptDialog } from '../promptDialog'
import { openDestructiveGate } from '../../state/destructiveGate'

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
  const [packageOptions, setPackageOptions] = useState<Record<string, unknown>>({ wait: false, elevated: false, interactive: false, preRelease: false, skipHash: false })
  const requestDestructive = useCallback((input: { label: string; run: () => Promise<void> }) => {
    openDestructiveGate({ title: input.label, description: 'This action changes or removes UniGetUI state and cannot be undone through this panel.', affected: [input.label], confirmLabel: 'Confirm action', onConfirm: () => { void input.run() } })
  }, [])
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
      {!isUnavailable && !busy && <PageActions api={api} page={page} vocab={vocab} onDestructive={requestDestructive} onPayload={setPayload} />}
      {!isUnavailable && !busy && (page === 'discover' || page === 'installed' || page === 'updates') && <PackageOptions value={packageOptions} onChange={setPackageOptions} vocab={vocab} />}
      {!isUnavailable && !busy && page === 'discover' && <DiscoverActions api={api} rows={rows} vocab={vocab} options={packageOptions} />}
      {!isUnavailable && !busy && page !== 'discover' && rows.length > 0 && <DataRows api={api} page={page} rows={rows} vocab={vocab} options={packageOptions} onDestructive={requestDestructive} onPayload={setPayload} />}
      {!isUnavailable && !busy && page !== 'discover' && rows.length === 0 && <pre className="unigetui-universe__empty">{payload ? JSON.stringify(payload, null, 2) : vocab('No data was returned for this section.')}</pre>}
      {page === 'help' && <p className="unigetui-universe__help">{vocab('Package actions are delegated to UniGetUI through its public local automation interface. Credentials and manager state stay with UniGetUI.')} </p>}
    </aside>
  )
}

function PackageOptions({ value, onChange, vocab }: { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; vocab: (value: string) => string }): React.JSX.Element {
  const text = (key: string, label: string, placeholder: string) => <label>{vocab(label)}<span className="unigetui-universe__option-input"><input value={typeof value[key] === 'string' ? value[key] as string : ''} placeholder={placeholder} onChange={(event) => onChange({ ...value, [key]: event.target.value || undefined })} />{key === 'location' && <button type="button" onClick={() => void window.nodeTerminal.dialog.selectFolder().then((path) => path && onChange({ ...value, location: path }))}>{vocab('Browse')}</button>}</span></label>
  const flag = (key: string, label: string) => <label><input type="checkbox" checked={value[key] === true} onChange={(event) => onChange({ ...value, [key]: event.target.checked })} />{vocab(label)}</label>
  return <details className="unigetui-universe__options"><summary>{vocab('Package operation options')}</summary><div className="unigetui-universe__options-grid">{text('manager', 'Manager', 'winget')}{text('source', 'Source', 'source name')}{text('version', 'Version', 'optional version')}{text('scope', 'Scope', 'User or Machine')}{text('architecture', 'Architecture', 'x64')}{text('location', 'Install location', 'absolute path')}{flag('preRelease', 'Include prerelease')}{flag('interactive', 'Interactive operation')}{flag('elevated', 'Request elevation')}{flag('skipHash', 'Skip hash check')}{flag('wait', 'Wait for completion')}</div></details>
}

function DiscoverActions({ api, rows, vocab, options }: { api: UniGetUiApi; rows: Array<Record<string, unknown>>; vocab: (value: string, vars?: Record<string, string>) => string; options: Record<string, unknown> }): React.JSX.Element {
  return <ul className="unigetui-universe__rows">{rows.map((row, index) => { const id = typeof row.id === 'string' ? row.id : typeof row.packageId === 'string' ? row.packageId : ''; return <li key={`${id}-${index}`}><span>{rowText(row) || vocab('Unnamed package')}</span><button type="button" disabled={!id} onClick={() => void api.packageInstall(id, options)}>{vocab('Install')}</button><button type="button" disabled={!id} onClick={() => void api.packageDownload(id, options)}>{vocab('Download')}</button></li> })}</ul>
}

function PageActions({ api, page, vocab, onDestructive, onPayload }: { api: UniGetUiApi; page: UniGetUiPage; vocab: (value: string) => string; onDestructive: (action: { label: string; run: () => Promise<void> }) => void; onPayload: (value: unknown) => void }): React.JSX.Element | null {
  const action = (label: string, run: () => Promise<unknown>): React.JSX.Element => <button type="button" onClick={() => void run()}>{vocab(label)}</button>
  const destructive = (label: string, run: () => Promise<unknown>): React.JSX.Element => <button type="button" onClick={() => onDestructive({ label, run: async () => { await run() } })}>{vocab(label)}</button>
  if (page === 'updates') return <div className="unigetui-universe__page-actions">{action('Update all', () => api.packageUpdateAll({ wait: false }))}{action('Show ignored updates', () => api.ignoredUpdates().then(onPayload))}</div>
  if (page === 'backups') return <div className="unigetui-universe__page-actions">{action('Create local backup', () => api.backupLocalCreate())}{action('List cloud backups', () => api.backupCloudList().then(onPayload))}{action('Create cloud backup', () => api.backupCloudCreate())}{action('Start backup sign-in', () => api.backupLoginStart(false))}{action('Complete backup sign-in', () => api.backupLoginComplete())}{action('Sign out of backup', () => api.backupLogout())}{action('Download cloud backup', () => promptDialog({ message: 'Cloud backup key' }).then((key) => key ? api.backupCloudDownload(key) : undefined))}{action('Restore cloud backup', () => promptDialog({ message: 'Cloud backup key' }).then((key) => key ? api.backupCloudRestore(key, true) : undefined))}</div>
  if (page === 'sources') return <div className="unigetui-universe__page-actions"><button type="button" onClick={() => void promptDialog({ message: 'Manager id' }).then((manager) => manager && promptDialog({ message: 'Source name' }).then((name) => name && promptDialog({ message: 'Source URL (optional)' }).then((url) => void api.sourceAdd(manager, name, url || undefined))))}>{vocab('Add source')}</button></div>
  if (page === 'bundles') return <div className="unigetui-universe__page-actions">{action('Refresh bundle', () => api.bundle().then(onPayload))}{destructive('Reset bundle', () => api.bundleReset())}{action('Import bundle file', () => window.nodeTerminal.dialog.selectFile().then((path) => path ? api.bundleImport({ path }) : undefined))}{action('Export bundle', () => api.bundleExport())}<button type="button" onClick={() => void promptDialog({ message: 'Package id' }).then((id) => id ? api.bundleAdd({ id }) : undefined)}>{vocab('Add package')}</button><button type="button" onClick={() => void promptDialog({ message: 'Package id to remove' }).then((id) => id && onDestructive({ label: `Remove ${id} from bundle?`, run: async () => { await api.bundleRemove({ id }) } }))}>{vocab('Remove package')}</button>{action('Install bundle', () => api.bundleInstall({ elevated: false }))}</div>
  if (page === 'settings') return <div className="unigetui-universe__page-actions">{destructive('Reset non-secure settings', () => api.settingsReset())}</div>
  if (page === 'shortcuts') return <div className="unigetui-universe__page-actions">{destructive('Reset shortcut decisions', () => api.shortcutResetAll())}</div>
  if (page === 'operations') return <div className="unigetui-universe__page-actions">{action('Refresh operations', () => api.operations().then(onPayload))}</div>
  return null
}

function DataRows({ api, page, rows, vocab, options, onDestructive, onPayload }: { api: UniGetUiApi; page: UniGetUiPage; rows: Array<Record<string, unknown>>; vocab: (value: string) => string; options: Record<string, unknown>; onDestructive: (action: { label: string; run: () => Promise<void> }) => void; onPayload: (value: unknown) => void }): React.JSX.Element {
  return <ul className="unigetui-universe__rows">{rows.map((row, index) => {
    const id = typeof row.id === 'string' ? row.id : typeof row.packageId === 'string' ? row.packageId : ''
    const manager = typeof row.manager === 'string' ? row.manager : typeof row.managerName === 'string' ? row.managerName : typeof row.id === 'string' && page === 'managers' ? row.id : undefined
    const destructive = (label: string, run: () => Promise<unknown>) => onDestructive({ label, run: async () => { await run() } })
    const actions: React.JSX.Element[] = []
    if ((page === 'installed' || page === 'updates') && id) {
      actions.push(<button key="update" type="button" onClick={() => void api.packageUpdate(id, { ...options, manager } as never)}>{vocab('Update')}</button>)
      actions.push(<button key="download" type="button" onClick={() => void api.packageDownload(id, { ...options, manager } as never)}>{vocab('Download')}</button>)
      actions.push(<button key="reinstall" type="button" onClick={() => void api.packageReinstall(id, { ...options, manager } as never)}>{vocab('Reinstall')}</button>)
      actions.push(<button key="repair" type="button" onClick={() => void api.packageRepair(id, manager, options as never)}>{vocab('Repair')}</button>)
      actions.push(<button key="uninstall" type="button" onClick={() => destructive(`Uninstall ${id}?`, () => api.packageUninstall(id, manager, options as never))}>{vocab('Uninstall')}</button>)
      actions.push(<button key="ignore" type="button" onClick={() => void api.ignoredUpdateAdd(id, { manager, version: typeof row.version === 'string' ? row.version : undefined })}>{vocab('Ignore updates')}</button>)
      if (manager && page === 'updates') actions.push(<button key="manager-update" type="button" onClick={() => void api.packageUpdateManager(manager, options as never)}>{vocab('Update manager')}</button>)
    } else if (page === 'operations' && id) {
      actions.push(<button key="output" type="button" onClick={() => void api.operationOutput(id).then(onPayload)}>{vocab('Output')}</button>)
      actions.push(<button key="cancel" type="button" onClick={() => void api.operationCancel(id)}>{vocab('Cancel')}</button>)
      actions.push(<button key="retry" type="button" onClick={() => void api.operationRetry(id)}>{vocab('Retry')}</button>)
      actions.push(<button key="forget" type="button" onClick={() => destructive(`Forget operation ${id}?`, () => api.operationForget(id))}>{vocab('Forget')}</button>)
    } else if (page === 'managers' && manager) {
      for (const action of ['enable', 'disable', 'reload', 'maintenance', 'notifications-enable', 'notifications-disable', 'clear-executable']) actions.push(<button key={action} type="button" onClick={() => void api.managerAction(manager, action)}>{vocab(action)}</button>)
      actions.push(<button key="set-executable" type="button" onClick={() => void window.nodeTerminal.dialog.selectFile().then((path) => path ? api.managerAction(manager, 'set-executable', { path }) : undefined)}>{vocab('Set executable')}</button>)
    } else if (page === 'sources' && manager && id) {
      actions.push(<button key="remove" type="button" onClick={() => destructive(`Remove source ${id}?`, () => api.sourceRemove(manager, id))}>{vocab('Remove')}</button>)
    } else if (page === 'settings' && id) {
      const current = typeof row.value === 'string' || typeof row.value === 'boolean' ? row.value : ''
      actions.push(<label key="value">{vocab('Value')}<input defaultValue={String(current)} onBlur={(event) => void api.settingSet(id, typeof current === 'boolean' ? { enabled: event.currentTarget.value === 'true' } : { value: event.currentTarget.value })} /></label>)
      actions.push(<button key="clear" type="button" onClick={() => void api.settingClear(id)}>{vocab('Clear')}</button>)
    } else if (page === 'shortcuts' && (typeof row.path === 'string' || id)) {
      const shortcutPath = typeof row.path === 'string' ? row.path : id
      actions.push(<button key="keep" type="button" onClick={() => void api.shortcutSet(shortcutPath, 'keep')}>{vocab('Keep')}</button>)
      actions.push(<button key="delete" type="button" onClick={() => destructive(`Delete shortcut ${shortcutPath}?`, () => api.shortcutSet(shortcutPath, 'delete'))}>{vocab('Delete')}</button>)
      actions.push(<button key="reset" type="button" onClick={() => void api.shortcutReset(shortcutPath)}>{vocab('Reset')}</button>)
    }
    return <li key={index}><pre>{JSON.stringify(row, null, 2)}</pre>{actions.length > 0 && <div className="unigetui-universe__row-actions">{actions}</div>}</li>
  })}</ul>
}
