import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import type { CdkApi, CdkOperation, CdkReviewedChange, CdkStatus } from '@shared/cdk'
import { useSession } from '../../session/session'
import type { DialogApi } from '@shared/types'
import { Button, Checkbox, TextField } from '@renderer/ui/md3'

type PanelTab = 'project' | 'trust' | 'operations' | 'output'

function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { message, kind } }))
}

function operationLabel(operation: CdkOperation): string {
  return operation[0].toUpperCase() + operation.slice(1)
}

function reviewedChange(status: CdkStatus, operation: Exclude<CdkOperation, 'bootstrap'>, acknowledged: boolean): CdkReviewedChange | null {
  if (!status.folder || !status.trust) return null
  return { operation, folder: status.folder, trustFingerprint: status.trust.fingerprint, acknowledged, reviewedAt: Date.now() }
}

function StatusSummary({ status }: { status: CdkStatus | null }): React.JSX.Element {
  if (!status) return <p className="service-node__note">Choose a CDK project folder to begin.</p>
  if (status.phase === 'error') return <p className="service-node__note mc-note--warn">CDK manager needs attention. Read the Trust review and Output tabs for the exact reason.</p>
  return <p className="service-node__note">{status.phase === 'completed' ? 'Last operation completed.' : 'Project is ready for a reviewed workflow.'}</p>
}

function ProjectTab({ api, dialog, status, onStatus }: { api: CdkApi; dialog: DialogApi; status: CdkStatus | null; onStatus: (s: CdkStatus) => void }): React.JSX.Element {
  const [folder, setFolder] = useState(status?.folder ?? '')
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (status?.detected?.manifestFiles ?? []).filter((file) => !q || file.toLowerCase().includes(q))
  }, [query, status?.detected?.manifestFiles])
  const choose = async (): Promise<void> => {
    const selected = await dialog.selectFolder()
    if (selected) {
      setFolder(selected)
      onStatus(await api.inspect(selected))
    }
  }
  const inspect = async (): Promise<void> => {
    if (!folder.trim()) return
    onStatus(await api.inspect(folder.trim()))
  }
  return (
    <section>
      <h3>Project folder</h3>
      <p className="service-node__note">Pick the CDK root. Paths are used only on this machine and are never written to portable project data.</p>
      <div className="om-actions">
        <TextField label="CDK project folder" aria-label="CDK project folder" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Choose a folder" />
        <Button variant="outlined" onClick={() => void choose()}>Browse…</Button>
        <Button variant="tonal" onClick={() => void inspect()} disabled={!folder.trim()}>Inspect</Button>
      </div>
      <StatusSummary status={status} />
      {status?.detected && (
        <dl className="cdk-facts">
          <div><dt>Application</dt><dd>{status.detected.appName}</dd></div>
          <div><dt>Language</dt><dd>{status.detected.language}</dd></div>
          <div><dt>Environment</dt><dd>{status.detected.environment}</dd></div>
          <div><dt>Entrypoint</dt><dd><code>{status.detected.entrypoint ?? 'not declared'}</code></dd></div>
          <div><dt>CDK toolkit</dt><dd>{status.dependencies?.toolkit.installed ?? 'not installed'} {status.dependencies?.toolkit.verified ? '· verified' : '· bootstrap required'}</dd></div>
        </dl>
      )}
      {status?.detected && (
        <details>
          <summary>Reviewed manifests ({filtered.length})</summary>
          <TextField label="Search CDK manifests" aria-label="Search CDK manifests" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search manifests" />
          <ul>{filtered.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
        </details>
      )}
    </section>
  )
}

function TrustTab({ status, acknowledged, setAcknowledged }: { status: CdkStatus | null; acknowledged: boolean; setAcknowledged: (v: boolean) => void }): React.JSX.Element {
  if (!status?.trust) return <p className="om-empty-note">Inspect a project before reviewing it.</p>
  return (
    <section>
      <h3>Trust review</h3>
      <p className="service-node__note">The manager will execute only the project-local verified CDK launcher with fixed workflows. Review the entrypoint and manifests before acknowledging.</p>
      <p role="status">{status.trust.safe ? 'No unsafe command construction was found.' : 'This review is not safe to run.'}</p>
      {status.trust.findings.length > 0 && <ul className="mc-note--warn">{status.trust.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul>}
      <p>Review fingerprint: <code>{status.trust.fingerprint}</code></p>
      <label className="mc-checkbox"><Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} disabled={!status.trust.safe} /> I reviewed the app entrypoint, dependency manifests, and intended AWS changes.</label>
      <p className="service-node__note">Deploy and destroy remain disabled until this acknowledgement is current. Credentials and AWS sessions are never stored by this manager.</p>
    </section>
  )
}

function OperationsTab({ api, status, acknowledged, onStatus, setTab }: { api: CdkApi; status: CdkStatus | null; acknowledged: boolean; onStatus: (s: CdkStatus) => void; setTab: (tab: PanelTab) => void }): React.JSX.Element {
  const [busy, setBusy] = useState<CdkOperation | null>(null)
  const run = async (operation: Exclude<CdkOperation, 'bootstrap'>): Promise<void> => {
    const review = reviewedChange(status!, operation, acknowledged)
    if (!review) return toast('Review the project and acknowledge the intended change first.', 'error')
    setBusy(operation)
    try {
      const result = await api[operation](status!.folder!, review)
      if (!result.ok) toast(result.error ?? `CDK ${operation} did not complete.`, 'error')
      setTab('output')
    } finally { setBusy(null); if (status?.folder) onStatus(await api.status(status.folder)) }
  }
  const bootstrap = async (): Promise<void> => {
    if (!status?.folder) return
    setBusy('bootstrap')
    try { const result = await api.bootstrap(status.folder); if (!result.ok) toast(result.error ?? 'CDK bootstrap did not complete.', 'error'); setTab('output') }
    finally { setBusy(null); onStatus(await api.status(status.folder)) }
  }
  const toolkitReady = status?.dependencies?.toolkit.verified === true
  const disabled = !status?.folder || !status.trust?.safe || !acknowledged || !toolkitReady || busy !== null
  return (
    <section>
      <h3>Reviewed workflows</h3>
      <p className="service-node__note">Bootstrap verifies local dependencies. Synth, diff, deploy, and destroy use fixed typed commands, never a freeform shell.</p>
      <div className="om-actions">
        <Button variant="outlined" onClick={() => void bootstrap()} disabled={!status?.folder || busy !== null}>{busy === 'bootstrap' ? 'Bootstrapping…' : 'Bootstrap dependencies'}</Button>
        {(['synth', 'diff', 'deploy', 'destroy'] as const).map((operation) => <Button key={operation} variant={operation === 'deploy' ? 'filled' : 'tonal'} onClick={() => void run(operation)} disabled={disabled} title={disabled ? 'Inspect a safe project and acknowledge the trust review first' : undefined}>{busy === operation ? `${operationLabel(operation)}…` : operationLabel(operation)}</Button>)}
        {busy && <Button variant="outlined" onClick={() => void api.cancel(status!.folder!)}>Cancel {operationLabel(busy)}</Button>}
      </div>
      {disabled && <p className="service-node__note">Actions are disabled until a safe trust review is acknowledged and the pinned CDK toolkit is verified. Bootstrap dependencies first when it is not verified.</p>}
    </section>
  )
}

function OutputTab({ status }: { status: CdkStatus | null }): React.JSX.Element {
  const result = status?.lastResult
  if (!result) return <p className="om-empty-note">No CDK workflow has run yet.</p>
  return <section><h3>{operationLabel(result.operation)} output</h3><p role="status">{result.ok ? 'Completed' : 'Failed'} · exit code {result.exitCode ?? 'unknown'} · {result.durationMs} ms{result.truncated ? ' · output truncated at the safety bound' : ''}</p><pre className="cdk-output">{result.output || result.error || 'No output was reported.'}</pre>{result.assets.length > 0 && <details><summary>Generated assets ({result.assets.length})</summary><ul>{result.assets.map((asset) => <li key={asset.path}><code>{asset.path}</code> · {asset.bytes} bytes · <code>{asset.sha256}</code></li>)}</ul></details>}</section>
}

export function CdkManagerPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { api } = useSession()
  const [status, setStatus] = useState<CdkStatus | null>(null)
  const [tab, setTab] = useState<PanelTab>('project')
  const [acknowledged, setAcknowledged] = useState(false)
  useEffect(() => api.cdk.onEvent((event) => { setStatus(event.status); if (event.status.phase === 'error') setTab('trust') }), [api.cdk])
  return createPortal(<div className="drawer-overlay md3-ollama" onClick={onClose}><aside className="drawer ollama" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AWS CDK manager"><div className="drawer__head"><h2>AWS CDK manager</h2><button className="drawer__close" onClick={onClose} aria-label="Close">×</button></div><div className="drawer__body om-body"><div className="om-tabs" role="tablist">{(['project', 'trust', 'operations', 'output'] as PanelTab[]).map((name) => <button key={name} role="tab" aria-selected={tab === name} className={`om-tab${tab === name ? ' om-tab--active' : ''}`} onClick={() => setTab(name)}>{name === 'project' ? 'Project' : name === 'trust' ? 'Trust review' : name === 'operations' ? 'Workflows' : 'Output'}</button>)}</div>{tab === 'project' && <ProjectTab api={api.cdk} dialog={api.dialog} status={status} onStatus={setStatus} />}{tab === 'trust' && <TrustTab status={status} acknowledged={acknowledged} setAcknowledged={setAcknowledged} />}{tab === 'operations' && <OperationsTab api={api.cdk} status={status} acknowledged={acknowledged} onStatus={setStatus} setTab={setTab} />}{tab === 'output' && <OutputTab status={status} />}</div></aside></div>, document.body)
}
