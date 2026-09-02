import { useEffect, useMemo, useRef, useState } from 'react'
import {
  GITLAB_HOSTING_IMAGES,
  GITLAB_HOSTING_VOLUME_ROLES,
  type GitLabBackupSummary,
  type GitLabHostingConfig,
  type GitLabHostingStatus
} from '@shared/gitlab-hosting'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'
import { openDestructiveGate } from '../../state/destructiveGate'
import { Button } from '../../ui/Button'
import { Input } from '../../ui/Input'
import { Chip } from '@renderer/ui/md3'

const HTTP_PORTS = [8929, 8930, 8931, 8932] as const
const SSH_PORTS = [2224, 2225, 2226, 2227] as const

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Size unavailable'
  if (value < 1024 * 1024) return `${value} bytes`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

export interface GitLabHostingPanelProps {
  nodeId: string
  config: GitLabHostingConfig
  onConfigChange: (config: GitLabHostingConfig) => void
}

/**
 * Guided GitLab Server host controls. The only free text field is the local search over
 * discovered Docker contexts and backups. Images, ports, edition, and operations are closed
 * choices, and every search owns its adjacent full regex builder.
 */
export function GitLabHostingPanel({ nodeId, config, onConfigChange }: GitLabHostingPanelProps): React.JSX.Element {
  const manager = window.nodeTerminal.relayHost.manager.gitlab
  const [contexts, setContexts] = useState<Awaited<ReturnType<typeof window.nodeTerminal.relayHost.manager.contexts>>>([])
  const [context, setContext] = useState('')
  const [status, setStatus] = useState<GitLabHostingStatus | null>(null)
  const [backups, setBackups] = useState<GitLabBackupSummary[]>([])
  const [selectedBackup, setSelectedBackup] = useState('')
  const [credential, setCredential] = useState<{ username: string; password: string; expiresAt: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [jobs, setJobs] = useState<Array<{ jobId: string; label: string; phase: string; message: string; completedSteps: number; totalSteps: number }>>([])
  const contextSearch = useRegexSearchField()
  const contextSearchRef = useRef<HTMLInputElement>(null)
  const backupSearch = useRegexSearchField()
  const backupSearchRef = useRef<HTMLInputElement>(null)

  const refresh = async (wanted = context): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const found = await window.nodeTerminal.relayHost.manager.contexts()
      setContexts(found)
      const chosen = wanted || found.find((item) => item.current)?.name || found[0]?.name || ''
      setContext(chosen)
      if (!chosen) {
        setStatus(null)
        setBackups([])
        setError('No Docker context is available. Start Docker or choose a saved context, then retry.')
        return
      }
      const [next, listed] = await Promise.all([manager.status(chosen, nodeId), manager.backups(chosen, nodeId).catch(() => [])])
      setStatus(next)
      setBackups(listed)
      setSelectedBackup((current) => listed.some((item) => item.id === current) ? current : listed[0]?.id ?? '')
    } catch (cause) {
      setStatus(null)
      setBackups([])
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void refresh('') }, [nodeId])
  useEffect(() => window.nodeTerminal.relayHost.manager.onProgress((progress) => {
    if (!progress.label.toLowerCase().includes('gitlab')) return
    setJobs((current) => [{ jobId: progress.jobId, label: progress.label, phase: progress.phase, message: progress.message, completedSteps: progress.completedSteps, totalSteps: progress.totalSteps }, ...current.filter((job) => job.jobId !== progress.jobId)].slice(0, 8))
    if (progress.phase === 'completed') void refresh()
  }), [context, nodeId])

  const run = async (action: Parameters<typeof manager.run>[0]): Promise<void> => {
    setError('')
    try { await manager.run(action) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const destructive = (title: string, description: string, affected: string, action: Parameters<typeof manager.run>[0]): void => {
    openDestructiveGate({ title, description, affected: [affected], confirmLabel: title, onConfirm: () => void run(action) })
  }

  const visibleContexts = contexts.filter((item) => contextSearch.test(`${item.name} ${item.endpointLabel} ${item.kind}`))
  const visibleBackups = useMemo(() => backups.filter((item) => backupSearch.test(`${item.filename} ${item.sizeBytes ?? ''} ${item.createdAt ?? ''}`)), [backupSearch, backups])
  const image = GITLAB_HOSTING_IMAGES.find((item) => item.edition === config.edition) ?? GITLAB_HOSTING_IMAGES[0]
  const currentJob = jobs.find((job) => job.phase === 'queued' || job.phase === 'running')

  return (
    <section className="gitlab-hosting-panel nodrag" aria-label="GitLab Server hosting">
      <header className="gitlab-hosting-panel__header">
        <div>
          <strong>GitLab Server hosting</strong>
          <p>Private-first hosting with a pinned official image and four managed volumes.</p>
        </div>
        <Button disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh'}</Button>
      </header>

      <section className="gitlab-hosting-panel__section" aria-label="Docker context">
        <h4>Docker context</h4>
        <div className="gitlab-hosting-panel__search">
          <Input ref={contextSearchRef} type="search" value={contextSearch.value} onChange={(event) => contextSearch.setValue(event.target.value)} placeholder="Search discovered contexts" aria-label="Search discovered Docker contexts" />
          <AnchoredRegexBuilder search={contextSearch} fieldRef={contextSearchRef} label="Regex builder for Docker context search" />
        </div>
        {contextSearch.error ? <p className="gitlab-hosting-panel__error" role="alert">{contextSearch.error}</p> : null}
        <div className="gitlab-hosting-panel__choices" role="listbox" aria-label="Discovered Docker contexts">
          {visibleContexts.map((item) => <Chip vocabularyMode="factual" selected={item.name === context} key={item.name} role="option" aria-selected={item.name === context} disabled={!item.available || busy} title={item.available ? item.endpointLabel : item.reason} className={item.name === context ? 'selected' : ''} onClick={() => void refresh(item.name)}>{item.name}<small>{item.kind}</small></Chip>)}
        </div>
      </section>

      <section className="gitlab-hosting-panel__section" aria-label="GitLab edition and image">
        <h4>Edition and pinned image</h4>
        <div className="gitlab-hosting-panel__choices" role="group" aria-label="GitLab edition">
          {GITLAB_HOSTING_IMAGES.map((candidate) => <Button size="small" vocabularyMode="factual" key={candidate.edition} type="button" className={candidate.edition === config.edition ? 'selected' : ''} onClick={() => onConfigChange({ ...config, edition: candidate.edition, image: candidate.ref })}>{candidate.label}</Button>)}
        </div>
        <p className="gitlab-hosting-panel__note">{image.ref}</p>
        <p className="gitlab-hosting-panel__note">The image digest is pinned and the binding is loopback-only. No arbitrary image, command, or public port is accepted.</p>
      </section>

      <section className="gitlab-hosting-panel__section" aria-label="Private binding ports">
        <h4>Private binding</h4>
        <p className="gitlab-hosting-panel__note">Only this computer can reach the published ports. Choose a free guided port pair.</p>
        <div className="gitlab-hosting-panel__port-row"><span>HTTP</span>{HTTP_PORTS.map((port) => <Button size="small" vocabularyMode="factual" key={port} type="button" className={config.httpPort === port ? 'selected' : ''} onClick={() => onConfigChange({ ...config, httpPort: port })}>{port}</Button>)}</div>
        <div className="gitlab-hosting-panel__port-row"><span>SSH</span>{SSH_PORTS.map((port) => <Button size="small" vocabularyMode="factual" key={port} type="button" className={config.sshPort === port ? 'selected' : ''} onClick={() => onConfigChange({ ...config, sshPort: port })}>{port}</Button>)}</div>
      </section>

      <section className="gitlab-hosting-panel__section" aria-label="Managed volumes">
        <h4>Managed volumes</h4>
        <div className="gitlab-hosting-panel__volumes">{GITLAB_HOSTING_VOLUME_ROLES.map((role) => <span key={role}><strong>{role}</strong><code>{status?.volumes[role] ?? `created on deploy (${role})`}</code></span>)}</div>
      </section>

      <section className="gitlab-hosting-panel__section" aria-label="GitLab lifecycle">
        <h4>Lifecycle</h4>
        <p className="gitlab-hosting-panel__status" role="status">{status ? `${status.phase}: ${status.detail}` : 'Choose a context to inspect this node.'}</p>
        <div className="gitlab-hosting-panel__actions">
          <Button disabled={!context || !!currentJob} onClick={() => void run({ type: 'deploy', context, nodeId, config })}>Deploy</Button>
          <Button disabled={!status?.ready || !!currentJob} onClick={() => void run({ type: 'backup', context, nodeId })}>Back up</Button>
          <Button disabled={!status?.ready || !!currentJob} onClick={() => void run({ type: 'update', context, nodeId, config })}>Update</Button>
          <Button disabled={!status || status.phase === 'missing' || !selectedBackup || !!currentJob} title={selectedBackup ? 'Restore the selected backup' : 'Choose a backup first.'} onClick={() => destructive('Restore backup', 'The selected backup replaces the current GitLab data. The four managed volumes remain attached.', selectedBackup, { type: 'restore', context, nodeId, backupId: selectedBackup })}>Restore</Button>
          <Button disabled={!status || !!currentJob} title={status?.phase === 'missing' ? 'Restore the previous container after an interrupted update' : 'Restore the previous pinned container'} onClick={() => destructive('Roll back GitLab', 'The previous pinned GitLab container is restored. Current container state is replaced.', status?.containerName ?? nodeId, { type: 'rollback', context, nodeId })}>Rollback</Button>
        </div>
      </section>

      <section className="gitlab-hosting-panel__section" aria-label="Backups">
        <h4>Backups</h4>
        <div className="gitlab-hosting-panel__search"><Input ref={backupSearchRef} type="search" value={backupSearch.value} onChange={(event) => backupSearch.setValue(event.target.value)} placeholder="Search backup files" aria-label="Search GitLab backups" /><AnchoredRegexBuilder search={backupSearch} fieldRef={backupSearchRef} label="Regex builder for GitLab backup search" /></div>
        {backupSearch.error ? <p className="gitlab-hosting-panel__error" role="alert">{backupSearch.error}</p> : null}
        <div className="gitlab-hosting-panel__backup-list" role="listbox" aria-label="GitLab backups">{visibleBackups.map((backup) => <Chip vocabularyMode="factual" selected={selectedBackup === backup.id} key={backup.id} role="option" aria-selected={selectedBackup === backup.id} className={selectedBackup === backup.id ? 'selected' : ''} onClick={() => setSelectedBackup(backup.id)}><strong>{backup.filename}</strong><small>{formatBytes(backup.sizeBytes)}{backup.createdAt ? ` · ${new Date(backup.createdAt).toLocaleString()}` : ''}</small></Chip>)}</div>
        {!visibleBackups.length ? <p className="gitlab-hosting-panel__note">No backups match this search. Backups appear after a completed backup operation.</p> : null}
      </section>

      <section className="gitlab-hosting-panel__section" aria-label="Initial credential handoff">
        <h4>Initial credential handoff</h4>
        <p className="gitlab-hosting-panel__note">GitLab publishes the initial root credential inside the container. It is fetched once into this UI, never logged, persisted, exported, or included in progress output.</p>
        <Button disabled={!status?.ready || !!credential} onClick={async () => { try { setCredential(await manager.handoffInitialCredential(context, nodeId)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } }}>Hand off initial credential</Button>
        {credential ? <div className="gitlab-hosting-panel__credential" role="status"><strong>{credential.username}</strong><Input vocabularyMode="factual" type="password" readOnly value={credential.password} aria-label="Initial root password, shown once" /><p>Shown once for this session. Expires {new Date(credential.expiresAt).toLocaleTimeString()}.</p><Button onClick={() => setCredential(null)}>Hide credential</Button></div> : null}
      </section>

      {error ? <p className="gitlab-hosting-panel__error" role="alert">{error}</p> : null}
      {jobs.length ? <section className="gitlab-hosting-panel__section" aria-label="GitLab operations"><h4>Operations</h4>{jobs.map((job) => <article key={job.jobId}><header><strong>{job.label}</strong><span>{job.phase} · {job.completedSteps}/{job.totalSteps}</span></header><progress max={job.totalSteps} value={job.completedSteps} /><p>{job.message}</p></article>)}</section> : null}
      {currentJob ? <span className="sr-only" role="status">{currentJob.label}: {currentJob.message}</span> : null}
    </section>
  )
}
