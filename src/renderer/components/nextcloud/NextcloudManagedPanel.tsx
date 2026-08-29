import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_NEXTCLOUD_PROFILE, NEXTCLOUD_SUPPORTED_RELEASES, type NextcloudBackupSummary, type NextcloudRelease, type NextcloudStatus } from '@shared/nextcloud'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'

/**
 * Guided manager for the fixed no-socket profile. The service owns PostgreSQL, Redis, and the
 * Nextcloud web container, all on a private network. The panel never exposes a raw image, env,
 * Compose, or shell field.
 */
export function NextcloudManagedPanel({ nodeId }: { nodeId: string }) {
  const api = window.nodeTerminal.nextcloud
  const [status, setStatus] = useState<NextcloudStatus | null>(null)
  const [release, setRelease] = useState<NextcloudRelease>(DEFAULT_NEXTCLOUD_PROFILE.release)
  const [port, setPort] = useState(String(DEFAULT_NEXTCLOUD_PROFILE.port))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [backups, setBackups] = useState<NextcloudBackupSummary[]>([])
  const backupSearch = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    const next = await api.status(nodeId)
    setStatus(next)
    if (next.profile) {
      setRelease(next.profile.release)
      setPort(String(next.profile.port))
      setBackups(await api.listBackups(nodeId))
    }
  }

  useEffect(() => {
    void refresh().catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
    return api.onEvent((event) => {
      if (event.id === nodeId) setStatus(event.status)
    })
  }, [api, nodeId])

  const filteredBackups = useMemo(() => {
    return backups.filter((backup) => backupSearch.test(`${backup.id} ${backup.release}`))
  }, [backups, backupSearch])

  const run = async (label: string, operation: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setMessage(`${label}…`)
    try {
      await operation()
      await refresh()
      setMessage(`${label} complete.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const configured = status?.profile !== null && status?.profile !== undefined
  return (
    <div className="service-node__body nextcloud-panel" aria-label="Nextcloud managed hosting">
      <p className="service-node__note">
        Fixed private profile: Nextcloud web, PostgreSQL, and Redis on a user-defined network. No
        Docker socket, arbitrary images, Compose text, shell commands, or editable environment.
      </p>
      <div className="nextcloud-panel__search">
        <label className="service-node__field" htmlFor={`${nodeId}-nextcloud-search`}>
          <span className="service-node__field-label">Search backups</span>
          <span className="service-node__field-row"><input ref={searchRef} id={`${nodeId}-nextcloud-search`} className="service-node__input nodrag" value={backupSearch.value} onChange={(event) => backupSearch.setValue(event.target.value)} placeholder="Plain text search" /><AnchoredRegexBuilder search={backupSearch} fieldRef={searchRef} label="Open regex builder for backup search" /></span>
        </label>
      </div>
      <label className="service-node__field" htmlFor={`${nodeId}-nextcloud-release`}>
        <span className="service-node__field-label">Supported release</span>
        <select id={`${nodeId}-nextcloud-release`} className="service-node__input nodrag" value={release} onChange={(event) => setRelease(event.target.value as NextcloudRelease)}>
          {NEXTCLOUD_SUPPORTED_RELEASES.map((item) => <option value={item} key={item}>{item}</option>)}
        </select>
      </label>
      <label className="service-node__field" htmlFor={`${nodeId}-nextcloud-port`}>
        <span className="service-node__field-label">Private local port</span>
        <input id={`${nodeId}-nextcloud-port`} className="service-node__input nodrag" type="number" min={1024} max={65535} value={port} onChange={(event) => setPort(event.target.value)} />
      </label>
      <p className="service-node__note" aria-live="polite">{status ? `State: ${status.phase}. Readiness: database ${status.readiness.database ? 'ready' : 'waiting'}, Redis ${status.readiness.redis ? 'ready' : 'waiting'}, web ${status.readiness.web ? 'ready' : 'waiting'}.` : 'Loading current state…'}</p>
      {status?.privateEndpoint && <p className="service-node__note">Private endpoint: <code>{status.privateEndpoint}</code>. Tunnel handoff: {status.tunnelHandoff}.</p>}
      {message && <p className="service-node__note" role="status">{message}</p>}
      <div className="service-node__actions">
        <button type="button" className="nodrag" disabled={busy || configured} onClick={() => void run('Install', () => api.install({ id: nodeId, release, port: Number(port) }))}>Install</button>
        <button type="button" className="nodrag" disabled={busy || !configured} onClick={() => void run('Update', () => api.update(nodeId, release))}>Update</button>
        <button type="button" className="nodrag" disabled={busy || !configured} onClick={() => void run('Backup', async () => { const backup = await api.backup(nodeId); setBackups((items) => [backup, ...items]) })}>Backup</button>
        <button type="button" className="nodrag" disabled={busy || !configured || backups.length === 0} onClick={() => { const selected = backups[0]; if (selected) void run('Restore', () => api.restore(nodeId, selected.id)) }}>Restore latest</button>
        <button type="button" className="nodrag" disabled={busy || !configured} onClick={() => void run('Rollback', () => api.rollback(nodeId))}>Rollback</button>
        <button type="button" className="nodrag" disabled={busy || !configured || status?.readiness.all !== true} onClick={() => void run('Prepare tunnel handoff', () => api.requestTunnelHandoff(nodeId))}>Prepare tunnel handoff</button>
      </div>
      <ul className="nextcloud-panel__backups" aria-label="Backups">
        {filteredBackups.length === 0 ? <li>No matching backups.</li> : filteredBackups.map((backup) => <li key={backup.id}><code>{backup.id}</code> · {backup.release} · {backup.sizeBytes} bytes</li>)}
      </ul>
      <p className="service-node__hint">Importing this project never deploys anything. The profile can be reopened elsewhere, then explicitly configured and privately installed on that host. Tunnel exposure is a separate later action after readiness.</p>
    </div>
  )
}
