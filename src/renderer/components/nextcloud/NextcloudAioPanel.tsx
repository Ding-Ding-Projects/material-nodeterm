import { useEffect, useMemo, useRef, useState } from 'react'
import {
  NEXTCLOUD_AIO_DEFAULT_CONFIG,
  NEXTCLOUD_AIO_IMAGE,
  NEXTCLOUD_AIO_SOURCE,
  type NextcloudAioConfig,
  type NextcloudAioContext,
  type NextcloudAioJobProgress,
  type NextcloudAioSnapshot
} from '@shared/nextcloud-aio'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { useI18n } from '../../lib/i18n'

type AioTab = 'overview' | 'backups' | 'recovery'

const TABS: Array<{ id: AioTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'backups', label: 'Backups' },
  { id: 'recovery', label: 'Restore and rollback' }
]

function rowText(row: NextcloudAioContext): string {
  return `${row.name} ${row.endpointLabel} ${row.available ? 'available' : row.reason ?? 'unavailable'}`
}

export function NextcloudAioPanel({
  nodeId: _nodeId,
  config,
  onConfigChange
}: {
  nodeId: string
  config?: NextcloudAioConfig
  onConfigChange: (config: NextcloudAioConfig) => void
}): React.JSX.Element {
  const { ts } = useI18n()
  const copy = (key: string, fallback: string): string => ts(`nextcloudAio.${key}`, fallback)
  const [contexts, setContexts] = useState<NextcloudAioContext[]>([])
  const [context, setContext] = useState('')
  const [snapshot, setSnapshot] = useState<NextcloudAioSnapshot | null>(null)
  const [tab, setTab] = useState<AioTab>('overview')
  const [jobs, setJobs] = useState<NextcloudAioJobProgress[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const backupSearch = useRegexSearchField()
  const backupSearchRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<NextcloudAioConfig>(config ?? NEXTCLOUD_AIO_DEFAULT_CONFIG)

  useEffect(() => { if (config) setDraft(config) }, [config])

  const refresh = async (wanted = context): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const found = await window.nodeTerminal.relayHost.nextcloudAio.contexts()
      setContexts(found)
      const selected = wanted || found.find((item) => item.current)?.name || found.find((item) => item.available)?.name || ''
      setContext(selected)
      setSnapshot(await window.nodeTerminal.relayHost.nextcloudAio.snapshot(selected))
    } catch (cause) {
      setSnapshot(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void refresh('') }, [])
  useEffect(() => window.nodeTerminal.relayHost.nextcloudAio.onProgress((progress) => {
    setJobs((current) => [progress, ...current.filter((job) => job.jobId !== progress.jobId)].slice(0, 12))
    if (progress.phase === 'completed') void refresh()
  }), [context])

  const run = async (action: Parameters<typeof window.nodeTerminal.relayHost.nextcloudAio.run>[0]): Promise<void> => {
    setError('')
    try { await window.nodeTerminal.relayHost.nextcloudAio.run(action) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const visibleContexts = useMemo(() => contexts.filter((item) => search.test(rowText(item))), [contexts, search])
  const selectedBackup = snapshot?.backups.find((item) => backupSearch.test(`${item.id} ${item.label} ${item.sizeLabel}`))
  const currentJob = jobs.find((job) => job.phase === 'queued' || job.phase === 'running')
  const setDraftValue = (patch: Partial<NextcloudAioConfig>): void => {
    const next = { ...draft, ...patch }
    setDraft(next)
    onConfigChange(next)
  }

  return (
    <div className="nextcloud-aio-panel nodrag" aria-label={copy('title', 'Nextcloud AIO hosting')}>
      <section className="service-node__body" aria-label={copy('authorityTitle', 'Docker authority disclosure')}>
        <h5>{copy('authorityTitle', 'Docker authority disclosure')}</h5>
        <p>{copy('authority', 'This profile mounts the Docker socket read-only so the official AIO master container can manage its child containers. Docker socket access can control the Docker host. It is not a security boundary.')}</p>
        <p>{copy('safety', 'The image source is pinned to the official Nextcloud AIO image. Privileged mode, arbitrary images, shell commands, Compose text, and free-form environment values are never accepted.')}</p>
        <p><a href={NEXTCLOUD_AIO_SOURCE} target="_blank" rel="noreferrer">{copy('source', 'Review the pinned official source')}</a> · <code>{NEXTCLOUD_AIO_IMAGE}</code></p>
      </section>

      <div className="nextcloud-aio-panel__tabs" role="tablist" aria-label={copy('tabs', 'Nextcloud AIO sections')}>
        {TABS.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{copy(item.id, item.label)}</button>)}
      </div>

      <div className="nextcloud-aio-panel__toolbar">
        <div className="nextcloud-aio-panel__search">
          <Input ref={searchRef} type="search" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder={copy('searchContexts', 'Search Docker contexts')} aria-label={copy('searchContexts', 'Search Docker contexts')} />
          <AnchoredRegexBuilder search={search} fieldRef={searchRef} label={copy('regexContexts', 'Regex builder for Docker context search')} />
        </div>
        <Button disabled={busy} onClick={() => void refresh()}>{busy ? copy('refreshing', 'Refreshing…') : copy('refresh', 'Refresh')}</Button>
      </div>

      <div className="nextcloud-aio-panel__contexts" role="listbox" aria-label={copy('contexts', 'Available Docker contexts')}>
        {visibleContexts.map((item) => <button key={item.name} role="option" aria-selected={context === item.name} disabled={!item.available || busy} title={item.available ? item.endpointLabel : item.reason} onClick={() => void refresh(item.name)}>{item.name}<small>{item.endpointLabel}</small></button>)}
        {!visibleContexts.length && <p>{copy('noContexts', 'No available Docker context matches this search. Start Docker or choose another search.')}</p>}
      </div>
      {search.error ? <p role="alert">{search.error}</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      {tab === 'overview' && <section aria-label={copy('configure', 'Configure Nextcloud AIO')}>
        <label>{copy('binding', 'Local binding')}
          <select value={draft.bindingMode} onChange={(event) => setDraftValue({ bindingMode: event.target.value as NextcloudAioConfig['bindingMode'] })}>
            <option value="loopback">Loopback only</option><option value="private-network">Private network</option>
          </select>
        </label>
        <label>{copy('port', 'Local port')} <Input type="number" min={1024} max={65535} value={draft.port} onChange={(event) => setDraftValue({ port: Number(event.target.value) })} /></label>
        <p>{copy('portHint', 'Loopback keeps the service on this computer. Private network exposes it only on the selected private binding. Port must be between 1024 and 65535.')}</p>
        <Button disabled={!context || busy} title={context ? copy('deployReady', 'Deploy the pinned profile to the selected Docker context') : copy('chooseContext', 'Choose an available Docker context first.')} onClick={() => void run({ type: 'deploy', context, config: draft })}>{copy('deploy', 'Deploy pinned profile')}</Button>
        <div className="nextcloud-aio-panel__actions"><Button disabled={!context || busy} onClick={() => void run({ type: 'start', context })}>Start</Button><Button disabled={!context || busy} onClick={() => void run({ type: 'stop', context })}>Stop</Button><Button disabled={!context || busy} onClick={() => void run({ type: 'update', context, config: draft })}>Update image</Button></div>
      </section>}

      {tab === 'backups' && <section aria-label={copy('backups', 'Backups')}>
        <div className="nextcloud-aio-panel__search"><Input ref={backupSearchRef} type="search" value={backupSearch.value} onChange={(event) => backupSearch.setValue(event.target.value)} placeholder={copy('searchBackups', 'Search backups')} aria-label={copy('searchBackups', 'Search backups')} /><AnchoredRegexBuilder search={backupSearch} fieldRef={backupSearchRef} label={copy('regexBackups', 'Regex builder for backup search')} /></div>
        <Button disabled={!context || busy} title={context ? copy('createBackupReady', 'Create a local backup of the selected Nextcloud AIO data volume') : copy('chooseContext', 'Choose an available Docker context first.')} onClick={() => void run({ type: 'backup', context, backupId: `nodeterm-nextcloud-aio-backups-${Date.now()}` })}>Create backup</Button>
        {snapshot?.backups.filter((item) => backupSearch.test(`${item.id} ${item.label} ${item.sizeLabel}`)).map((backup) => <article key={backup.id}><strong>{backup.label}</strong><span>{backup.sizeLabel}</span><small>{new Date(backup.createdAt).toLocaleString()}</small></article>)}
        {!snapshot?.backups.length && <p>{copy('noBackups', 'No local backup records are available yet. Create one after deployment.')}</p>}
      </section>}

      {tab === 'recovery' && <section aria-label={copy('recovery', 'Restore and rollback')}>
        <div className="nextcloud-aio-panel__search"><Input ref={backupSearchRef} type="search" value={backupSearch.value} onChange={(event) => backupSearch.setValue(event.target.value)} placeholder={copy('searchBackups', 'Search backups')} aria-label={copy('searchBackups', 'Search backups')} /><AnchoredRegexBuilder search={backupSearch} fieldRef={backupSearchRef} label={copy('regexBackups', 'Regex builder for backup search')} /></div>
        <p>{copy('recoveryNote', 'Restore and rollback are explicit local operations. Choose a discovered backup record; no path or shell input is accepted.')}</p>
        {selectedBackup ? <><p>{selectedBackup.label} · {selectedBackup.sizeLabel}</p><div className="nextcloud-aio-panel__actions"><Button disabled={!context || busy} onClick={() => void run({ type: 'restore', context, backupId: selectedBackup.id })}>Restore selected backup</Button><Button disabled={!context || busy} onClick={() => void run({ type: 'rollback', context, backupId: selectedBackup.id })}>Rollback to selected backup</Button></div></> : <p>{copy('chooseBackup', 'Search for and select a discovered backup record first.')}</p>}
      </section>}

      {snapshot ? <section className="nextcloud-aio-panel__status" aria-live="polite"><strong>{snapshot.status.health}</strong><span>{snapshot.status.message}</span><small>{snapshot.status.privileged ? 'Privileged mode enabled' : 'Privileged mode disabled'} · {snapshot.status.socketAuthority}</small></section> : null}
      {jobs.length ? <section className="nextcloud-aio-panel__jobs" aria-label={copy('operations', 'Operations')}><h5>{copy('operations', 'Operations')}</h5>{jobs.map((job) => <article key={job.jobId}><strong>{job.operation}</strong><span>{job.phase} · {job.completedSteps}/{job.totalSteps}</span><progress max={job.totalSteps} value={job.completedSteps} /><p>{job.message}</p>{job.output ? <pre>{job.output}</pre> : null}{(job.phase === 'queued' || job.phase === 'running') ? <Button onClick={() => window.nodeTerminal.relayHost.nextcloudAio.cancel(job.jobId)}>Cancel</Button> : null}</article>)}</section> : null}
      {currentJob ? <span className="sr-only" role="status">{currentJob.operation}: {currentJob.message}</span> : null}
    </div>
  )
}
