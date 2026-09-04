import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from '../../session/session'
import { openDestructiveGate } from '../../state/destructiveGate'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { Button } from '../../ui/md3'
import { Input } from '../../ui/Input'
import { Select } from '../../ui/Select'
import type {
  GitLabBackupSummary,
  GitLabImageProfile,
  GitLabServerStatus
} from '@shared/gitlab'

function formatBytes(value: number | null): string {
  if (value === null) return 'Size not reported'
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function GitLabServerPanel({ nodeId, profileIntent, onProfileIntent }: { nodeId: string; profileIntent?: string; onProfileIntent?: (profileId: string) => void }): React.JSX.Element {
  const { api } = useSession()
  const [status, setStatus] = useState<GitLabServerStatus | null>(null)
  const [catalog, setCatalog] = useState<GitLabImageProfile[]>([])
  const [profileId, setProfileId] = useState(profileIntent ?? 'gitlab-ce-18.3.1')
  const [port, setPort] = useState(8929)
  const [backups, setBackups] = useState<GitLabBackupSummary[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = async (): Promise<void> => {
    const [nextStatus, nextCatalog] = await Promise.all([api.gitlab.status(nodeId), api.gitlab.catalog()])
    setStatus(nextStatus)
    setCatalog(nextCatalog)
    setProfileId((current) => profileIntent ?? nextStatus.profileId ?? current)
    setPort(nextStatus.hostPort)
    setBackups(await api.gitlab.listBackups(nodeId))
  }

  useEffect(() => {
    void refresh().catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)))
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 5000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, api.gitlab, profileIntent])

  const filteredCatalog = useMemo(
    () => catalog.filter((profile) => search.test(`${profile.label} ${profile.image} ${profile.version}`)),
    [catalog, search]
  )

  const run = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      setMessage(success)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <div className="service-node__body"><p className="service-node__note" role="alert">GitLab hosting is unavailable on this session: {loadError}</p><Button variant="outlined" className="sc-btn nodrag" onClick={() => { setLoadError(null); void refresh().catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error))) }}>Retry</Button></div>
  if (!status) return <div className="service-node__body"><p className="service-node__note">Loading GitLab hosting state…</p></div>

  const selected = catalog.find((profile) => profile.id === profileId) ?? catalog[0]
  const configured = status.profileId !== null
  const idPrefix = `${nodeId}-gitlab`

  return (
    <div className="service-node__body gitlab-panel">
      <div className="service-node__note">
        <strong>GitLab Server</strong> stays private-first at <code>127.0.0.1</code>. Docker is
        managed through fixed official profiles, four named volumes, and secret files.
      </div>

      {!configured && (
        <section className="gitlab-panel__section" aria-labelledby={`${idPrefix}-create-title`}>
          <h3 id={`${idPrefix}-create-title`}>Create a managed GitLab Server</h3>
          <label className="service-node__field" htmlFor={`${idPrefix}-search`}>
            <span className="service-node__field-label">Search official profiles</span>
            <span className="gitlab-panel__search-row">
              <Input
                ref={searchRef}
                id={`${idPrefix}-search`}
                className="service-node__input nodrag"
                value={search.value}
                placeholder="Search CE or EE profiles"
                onChange={(event) => search.setValue(event.target.value)}
              />
              <AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex for GitLab profile search" />
            </span>
          </label>
          <label className="service-node__field" htmlFor={`${idPrefix}-profile`}>
            <span className="service-node__field-label">Edition and pinned release</span>
            <Select id={`${idPrefix}-profile`} className="service-node__input nodrag" value={selected?.id ?? ''} onChange={(event) => { setProfileId(event.target.value); onProfileIntent?.(event.target.value) }}>
              {filteredCatalog.map((profile) => <option key={profile.id} value={profile.id}>{profile.label} · {profile.digest.slice(0, 19)}…</option>)}
            </Select>
            {!filteredCatalog.length && <span className="service-node__note">No profile matches this search.</span>}
          </label>
          <label className="service-node__field" htmlFor={`${idPrefix}-port`}>
            <span className="service-node__field-label">Private host port</span>
            <Input id={`${idPrefix}-port`} className="service-node__input nodrag" type="number" min={1024} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} />
          </label>
          <Button variant="filled" className="sc-btn nodrag" disabled={busy || !selected} onClick={() => void run(() => api.gitlab.create({ id: nodeId, profileId: selected?.id ?? '', hostPort: port }), 'GitLab start requested. Readiness is still being checked.')}>Create GitLab Server</Button>
          <p className="service-node__note">Preflight checks Docker, available disk capacity, and port availability before any volume or container is created.</p>
        </section>
      )}

      {configured && (
        <>
          <section className="gitlab-panel__section" aria-labelledby={`${idPrefix}-status-title`}>
            <h3 id={`${idPrefix}-status-title`}>Status</h3>
            <p className="service-node__note" role="status">{status.phase === 'ready' ? '✅ Ready' : status.phase === 'starting' ? '⏳ Starting and probing /users/sign_in' : status.phase === 'stopped' ? '⏸ Stopped' : `❌ ${status.lastError ?? status.phase}`}</p>
            <p className="service-node__note">Edition: {status.edition?.toUpperCase()} · {status.version} · <code>127.0.0.1:{status.hostPort}</code></p>
            <p className="service-node__note">Managed volumes: config, logs, data, backups. Initial root credential: {status.credentialHandedOff ? 'handed off once' : 'ready for one-time handoff'}.</p>
            <div className="gitlab-panel__actions">
              {!status.credentialHandedOff && <Button variant="outlined" className="sc-btn nodrag" disabled={busy} onClick={() => void api.gitlab.handoffCredential(nodeId).then((credential) => setMessage(credential ? `Root credential: ${credential.username} / ${credential.password}` : 'The initial credential was already handed off.')).catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))}>Show initial credential once</Button>}
              {status.phase === 'stopped' && <Button variant="outlined" className="sc-btn nodrag" disabled={busy} onClick={() => void run(() => api.gitlab.start(nodeId), 'GitLab Server start requested. Readiness is being checked.')}>Start GitLab Server</Button>}
              <Button variant="outlined" className="sc-btn nodrag" disabled={busy} onClick={() => void run(() => api.gitlab.createBackup(nodeId), 'Backup completed and recorded locally.')}>Create backup</Button>
              <Button variant="outlined" className="sc-btn nodrag" disabled={busy || !status.ready} onClick={() => void run(() => api.gitlab.tunnelHandoff(nodeId), 'Private origin handed to the tunnel wizard.')}>Continue to tunnel wizard</Button>
              <Button variant="outlined" className="sc-btn nodrag" disabled={busy} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openDestructiveGate({ title: 'Stop GitLab Server', description: 'Stops the managed container. The four persistent volumes remain intact.', affected: status.containerName ? [status.containerName] : undefined, confirmLabel: 'Stop GitLab Server', anchor: { x: rect.left, y: rect.bottom }, restoreFocusEl: event.currentTarget, onConfirm: () => void run(() => api.gitlab.stop(nodeId), 'GitLab Server stopped; persistent volumes remain.') }) }}>Stop</Button>
            </div>
          </section>

          <section className="gitlab-panel__section" aria-labelledby={`${idPrefix}-backup-title`}>
            <h3 id={`${idPrefix}-backup-title`}>Backups and recovery</h3>
            {backups.length ? <ul>{backups.map((backup) => <li key={backup.id}><code>{backup.filename}</code> · {formatBytes(backup.sizeBytes)} <Button variant="outlined" className="sc-btn nodrag" disabled={busy || !status.ready} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); openDestructiveGate({ title: 'Restore this GitLab backup', description: `Restores ${backup.filename} into the managed GitLab volumes. The current state is replaced by the selected backup.`, affected: [backup.filename], confirmLabel: 'Restore backup', anchor: { x: rect.left, y: rect.bottom }, restoreFocusEl: event.currentTarget, onConfirm: () => void run(() => api.gitlab.restoreBackup(nodeId, backup.id), 'GitLab backup restore requested.') }) }}>Restore</Button></li>)}</ul> : <p className="service-node__note">No managed backups yet.</p>}
          </section>

          <section className="gitlab-panel__section" aria-labelledby={`${idPrefix}-update-title`}>
            <h3 id={`${idPrefix}-update-title`}>Update and rollback</h3>
            <Select className="service-node__input nodrag" value={profileId} onChange={(event) => { setProfileId(event.target.value); onProfileIntent?.(event.target.value) }} aria-label="GitLab update profile">
              {catalog.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
            </Select>
            <div className="gitlab-panel__actions">
              <Button variant="filled" className="sc-btn nodrag" disabled={busy || profileId === status.profileId} onClick={() => void run(() => api.gitlab.update(nodeId, profileId), 'GitLab update requested. Persistent volumes were retained.')}>Update pinned release</Button>
              <Button variant="outlined" className="sc-btn nodrag" disabled={busy} onClick={() => void run(() => api.gitlab.rollback(nodeId), 'GitLab rollback requested using the previous pinned release.')}>Rollback</Button>
            </div>
          </section>
        </>
      )}
      {message && <p className="service-node__note" role="status">{message}</p>}
    </div>
  )
}
