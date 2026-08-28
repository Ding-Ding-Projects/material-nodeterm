import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_NEXTCLOUD_MANAGED_INTENT,
  NEXTCLOUD_MANAGED_OPERATION_STEPS,
  NEXTCLOUD_MANAGED_SECRET_FILES,
  type NextcloudManagedAction,
  type NextcloudManagedBinding,
  type NextcloudManagedIntent,
  type NextcloudManagedOperation,
  type NextcloudManagedProgress,
  validateNextcloudManagedAction
} from '@shared/nextcloud-managed'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { openDestructiveGate } from '../../state/destructiveGate'
import { useI18n } from '../../lib/i18n'

const OPERATIONS: readonly { id: NextcloudManagedOperation; label: string; description: string }[] = [
  { id: 'deploy', label: 'Deploy managed Nextcloud', description: 'Create the PostgreSQL, Redis, and web services on a private bridge.' },
  { id: 'update', label: 'Update web service', description: 'Create a versioned local snapshot, then update the fixed web image.' },
  { id: 'backup', label: 'Create backup', description: 'Write a versioned local backup without changing the running services.' },
  { id: 'restore', label: 'Restore snapshot', description: 'Stop writes, restore the selected snapshot, then start the stack in order.' },
  { id: 'rollback', label: 'Rollback update', description: 'Restore the last known-good snapshot and restart database, cache, and web.' }
]

const DEFAULT_BINDING_KEYS = NEXTCLOUD_MANAGED_SECRET_FILES.map((file) => `nextcloud:${file.id}`)

function operationCorpus(operation: typeof OPERATIONS[number]): string {
  return `${operation.id} ${operation.label} ${operation.description}`
}

function bindingFromForm(form: {
  context: string
  projectName: string
  dataDirectory: string
  backupDirectory: string
  loopbackPort: number
}): NextcloudManagedBinding {
  return {
    bindingVersion: 1,
    context: form.context,
    projectName: form.projectName,
    dataDirectory: form.dataDirectory,
    backupDirectory: form.backupDirectory,
    secretKeys: [...DEFAULT_BINDING_KEYS],
    loopbackPort: form.loopbackPort
  }
}

export interface NextcloudManagedPanelProps {
  nodeId: string
  intent?: NextcloudManagedIntent
  binding?: NextcloudManagedBinding
  onIntentChange: (intent: NextcloudManagedIntent) => void
  onBindingChange?: (binding: NextcloudManagedBinding | undefined) => void
}

/**
 * Guided operation surface for the no-socket profile. It exposes only real context and folder
 * pickers, fixed operations, and a closed host action union. It never accepts Compose text, image
 * names, entrypoints, shell commands, or secret values from the renderer.
 */
export function NextcloudManagedPanel({ nodeId, intent, binding, onIntentChange, onBindingChange }: NextcloudManagedPanelProps): React.JSX.Element {
  const { ts } = useI18n()
  const copy = (key: string, fallback: string): string => ts(`nextcloudManaged.${key}`, fallback)
  const operationSearch = useRegexSearchField()
  const operationSearchRef = useRef<HTMLInputElement>(null)
  const backupSearch = useRegexSearchField()
  const backupSearchRef = useRef<HTMLInputElement>(null)
  const serviceSearch = useRegexSearchField()
  const serviceSearchRef = useRef<HTMLInputElement>(null)
  const [contexts, setContexts] = useState<Awaited<ReturnType<typeof window.nodeTerminal.relayHost.manager.contexts>>>([])
  const [context, setContext] = useState(binding?.context ?? '')
  const [projectName, setProjectName] = useState(binding?.projectName ?? 'nodeterm-nextcloud')
  const [dataDirectory, setDataDirectory] = useState(binding?.dataDirectory ?? '')
  const [backupDirectory, setBackupDirectory] = useState(binding?.backupDirectory ?? '')
  const [loopbackPort, setLoopbackPort] = useState(binding?.loopbackPort ?? 18080)
  const [operation, setOperation] = useState<NextcloudManagedOperation>('deploy')
  const [snapshotId, setSnapshotId] = useState('')
  const [snapshots, setSnapshots] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<NextcloudManagedProgress | null>(null)

  const currentIntent = intent ?? DEFAULT_NEXTCLOUD_MANAGED_INTENT
  const chosenOperation = OPERATIONS.find((item) => item.id === operation) ?? OPERATIONS[0]
  const visibleOperations = useMemo(
    () => OPERATIONS.filter((item) => operationSearch.test(operationCorpus(item))),
    [operationSearch]
  )
  const visibleServices = useMemo(
    () => NEXTCLOUD_MANAGED_SECRET_FILES.filter((file) => serviceSearch.test(`${file.id} ${file.fileName} ${file.consumer}`)),
    [serviceSearch]
  )
  const visibleSnapshots = useMemo(
    () => snapshots.filter((item) => backupSearch.test(item)),
    [backupSearch, snapshots]
  )

  useEffect(() => {
    if (!intent) onIntentChange({ ...DEFAULT_NEXTCLOUD_MANAGED_INTENT })
  }, [intent, onIntentChange])

  useEffect(() => {
    let active = true
    void window.nodeTerminal.relayHost.manager.contexts().then((rows) => {
      if (!active) return
      setContexts(rows)
      if (!context) setContext(rows.find((row) => row.current)?.name ?? rows[0]?.name ?? '')
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    const unsubscribe = window.nodeTerminal.relayHost.nextcloudManaged.onProgress((event) => {
      if (event.jobId) setProgress(event)
      if (event.phase === 'completed' || event.phase === 'failed' || event.phase === 'cancelled') setBusy(false)
    })
    return () => { active = false; unsubscribe?.() }
  }, [])

  useEffect(() => {
    if (!context || !dataDirectory || !backupDirectory) {
      setSnapshots([])
      return
    }
    let active = true
    try {
      const local = bindingFromForm({ context, projectName, dataDirectory, backupDirectory, loopbackPort })
      const manager = window.nodeTerminal.relayHost.nextcloudManaged
      if (!manager) return () => { active = false }
      void manager.snapshots(local).then((items) => {
        if (active) setSnapshots(items)
      }).catch(() => { if (active) setSnapshots([]) })
    } catch {
      setSnapshots([])
    }
    return () => { active = false }
  }, [context, dataDirectory, backupDirectory, projectName, loopbackPort])

  const chooseFolder = async (setter: (value: string) => void): Promise<void> => {
    const chosen = await window.nodeTerminal.dialog.selectFolder()
    if (chosen) setter(chosen)
  }

  const saveBinding = (): NextcloudManagedBinding | null => {
    try {
      const next = bindingFromForm({ context, projectName, dataDirectory, backupDirectory, loopbackPort })
      validateNextcloudManagedAction({ operation: 'backup', ...next })
      onBindingChange?.(next)
      return next
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    }
  }

  const runOperation = async (kind: NextcloudManagedOperation): Promise<void> => {
    setError('')
    const local = saveBinding()
    if (!local) return
    const raw: NextcloudManagedAction = {
      operation: kind,
      context: local.context,
      projectName: local.projectName,
      dataDirectory: local.dataDirectory,
      backupDirectory: local.backupDirectory,
      loopbackPort: local.loopbackPort,
      ...(kind === 'restore' || kind === 'rollback' ? { snapshotId } : {})
    }
    try {
      const action = validateNextcloudManagedAction(raw)
      const manager = window.nodeTerminal.relayHost.nextcloudManaged
      if (!manager) throw new Error('Managed Nextcloud operations are unavailable on this surface. Use a desktop host with a Docker context.')
      setBusy(true)
      setProgress(null)
      await manager.run(action)
    } catch (cause) {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const requestOperation = (kind: NextcloudManagedOperation): void => {
    if (kind === 'restore' || kind === 'rollback') {
      openDestructiveGate({
        title: kind === 'restore' ? 'Restore Nextcloud snapshot' : 'Rollback Nextcloud update',
        description: 'This changes the managed service data after a snapshot is selected. The current data remains untouched until both confirmation keys and the full slider are complete.',
        affected: [snapshotId || 'the selected snapshot'],
        confirmLabel: kind === 'restore' ? 'Restore snapshot' : 'Rollback update',
        onConfirm: () => void runOperation(kind)
      })
      return
    }
    void runOperation(kind)
  }

  return (
    <div className="service-node__body nextcloud-managed nodrag" aria-label={copy('title', 'Managed Nextcloud hosting')}>
      <p className="service-node__note">{copy('intro', 'This profile manages PostgreSQL, Redis, and a Nextcloud web service without a container-runtime socket or privileged mode. Importing a project never deploys anything.')}</p>

      <label className="service-node__field" htmlFor={`${nodeId}-nextcloud-context`}>
        <span className="service-node__field-label">{copy('context', 'Docker context')}</span>
        <select id={`${nodeId}-nextcloud-context`} className="service-node__input nodrag" value={context} disabled={busy} onChange={(event) => setContext(event.target.value)}>
          <option value="">{copy('chooseContext', 'Choose a verified context')}</option>
          {contexts.map((item) => <option key={item.name} value={item.name} disabled={!item.available}>{item.name} · {item.endpointLabel}</option>)}
        </select>
      </label>

      <label className="service-node__field" htmlFor={`${nodeId}-nextcloud-project`}>
        <span className="service-node__field-label">{copy('projectName', 'Managed project name')}</span>
        <Input id={`${nodeId}-nextcloud-project`} value={projectName} disabled={busy} onChange={(event) => setProjectName(event.target.value)} />
      </label>

      <label className="service-node__field" htmlFor={`${nodeId}-nextcloud-data`}>
        <span className="service-node__field-label">{copy('dataFolder', 'Data folder')}</span>
        <div className="service-node__field-row"><Input id={`${nodeId}-nextcloud-data`} value={dataDirectory} disabled={busy} placeholder={copy('chooseFolder', 'Choose a local folder')} onChange={(event) => setDataDirectory(event.target.value)} /><Button disabled={busy} onClick={() => void chooseFolder(setDataDirectory)}>{copy('browse', 'Browse')}</Button></div>
      </label>

      <label className="service-node__field" htmlFor={`${nodeId}-nextcloud-backups`}>
        <span className="service-node__field-label">{copy('backupFolder', 'Backup folder')}</span>
        <div className="service-node__field-row"><Input id={`${nodeId}-nextcloud-backups`} value={backupDirectory} disabled={busy} placeholder={copy('chooseFolder', 'Choose a local folder')} onChange={(event) => setBackupDirectory(event.target.value)} /><Button disabled={busy} onClick={() => void chooseFolder(setBackupDirectory)}>{copy('browse', 'Browse')}</Button></div>
      </label>

      <label className="service-node__field" htmlFor={`${nodeId}-nextcloud-port`}>
        <span className="service-node__field-label">{copy('port', 'Loopback port')}</span>
        <Input id={`${nodeId}-nextcloud-port`} type="number" min={1024} max={65535} value={loopbackPort} disabled={busy} onChange={(event) => setLoopbackPort(Number(event.target.value))} />
      </label>

      <section aria-label="Managed services">
        <div className="docker-manager__search"><Input ref={serviceSearchRef} type="search" value={serviceSearch.value} onChange={(event) => serviceSearch.setValue(event.target.value)} placeholder={copy('searchServices', 'Search managed services')} /><AnchoredRegexBuilder search={serviceSearch} fieldRef={serviceSearchRef} label={copy('regexServices', 'Regex builder for managed service search')} /></div>
        <div className="docker-manager__pills" role="list" aria-label={copy('services', 'Fixed managed services')}>{visibleServices.map((file) => <span key={file.id} role="listitem">{file.consumer} · secret file `{file.fileName}`</span>)}</div>
      </section>

      <section aria-label="Managed operations">
        <div className="docker-manager__search"><Input ref={operationSearchRef} type="search" value={operationSearch.value} onChange={(event) => operationSearch.setValue(event.target.value)} placeholder={copy('searchOperations', 'Search managed operations')} /><AnchoredRegexBuilder search={operationSearch} fieldRef={operationSearchRef} label={copy('regexOperations', 'Regex builder for managed operation search')} /></div>
        <div className="docker-manager__pills" role="listbox" aria-label={copy('operations', 'Managed operation choices')}>{visibleOperations.map((item) => <button key={item.id} role="option" aria-selected={operation === item.id} className={operation === item.id ? 'selected' : ''} disabled={busy} title={item.description} onClick={() => setOperation(item.id)}>{copy(`operation.${item.id}`, item.label)}</button>)}</div>
        <p className="service-node__note">{copy('sequence', 'Sequence')}: {NEXTCLOUD_MANAGED_OPERATION_STEPS[chosenOperation.id].join(' → ')}. {copy('sequenceHint', 'Every step is fixed by the profile and can be cancelled while the host reports progress.')}</p>
        {(operation === 'restore' || operation === 'rollback') && <>
          <div className="docker-manager__search"><Input ref={backupSearchRef} type="search" value={backupSearch.value} onChange={(event) => backupSearch.setValue(event.target.value)} placeholder={copy('searchSnapshots', 'Search verified snapshots')} /><AnchoredRegexBuilder search={backupSearch} fieldRef={backupSearchRef} label={copy('regexSnapshots', 'Regex builder for snapshot search')} /></div>
          <div className="docker-manager__pills" role="listbox" aria-label={copy('snapshots', 'Verified snapshots')}>{visibleSnapshots.map((item) => <button key={item} role="option" aria-selected={snapshotId === item} className={snapshotId === item ? 'selected' : ''} onClick={() => setSnapshotId(item)}>{item}</button>)}</div>
          {!visibleSnapshots.length && <p className="service-node__note">{copy('noSnapshots', 'No verified snapshots are available yet. Create a backup first.')}</p>}
        </>}
        <Button disabled={busy || !context || !dataDirectory || !backupDirectory || ((operation === 'restore' || operation === 'rollback') && !snapshotId)} title={busy ? copy('busy', 'An operation is already running.') : (!context || !dataDirectory || !backupDirectory) ? copy('missingBinding', 'Choose a Docker context and both local folders first.') : ((operation === 'restore' || operation === 'rollback') && !snapshotId) ? copy('missingSnapshot', 'Choose a verified snapshot first.') : chosenOperation.description} onClick={() => requestOperation(operation)}>{busy ? copy('working', 'Working…') : chosenOperation.label}</Button>
      </section>

      {error ? <p className="service-node__note" role="alert">{error}</p> : null}
      {progress ? <section className="docker-manager__jobs" aria-label="Managed Nextcloud progress"><header><strong>{progress.operation}</strong><span>{progress.phase} · {progress.completedSteps}/{progress.totalSteps}</span></header><progress max={progress.totalSteps} value={progress.completedSteps} /><p>{progress.message}</p>{progress.output ? <pre>{progress.output}</pre> : null}{(progress.phase === 'queued' || progress.phase === 'preflight' || progress.phase === 'secrets' || progress.phase === 'database' || progress.phase === 'cache' || progress.phase === 'web' || progress.phase === 'backup' || progress.phase === 'restore' || progress.phase === 'rollback') ? <Button onClick={() => window.nodeTerminal.relayHost.nextcloudManaged.cancel(progress.jobId)}>Cancel</Button> : null}</section> : null}

      <div className="service-node__note"><strong>{copy('portableIntent', 'Portable intent')}:</strong> {currentIntent.profile}. {copy('localOnly', 'Context, folders, secret keys, process state, and generated runtime data stay on this computer. The project file carries only the no-socket profile choice.')}</div>
    </div>
  )
}
