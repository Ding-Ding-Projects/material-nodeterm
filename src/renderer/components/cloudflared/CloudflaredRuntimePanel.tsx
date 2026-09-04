import { useEffect, useMemo, useState } from 'react'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import type { CloudflaredRuntimeKind, CloudflaredRuntimeSettings, CloudflaredRuntimeStatus } from '@shared/cloudflared'
import { openDestructiveGate } from '../../state/destructiveGate'

const DEFAULTS: CloudflaredRuntimeSettings = {
  runtime: 'process', origin: 'http://127.0.0.1:3000', image: 'cloudflare/cloudflared:2025.8.1', cpus: 1, memoryMb: 512, pidsLimit: 128
}

function phaseText(status: CloudflaredRuntimeStatus | null): string {
  if (!status) return 'Checking connector state…'
  if (status.phase === 'running' && status.health === 'unknown') return 'Running, waiting for a connector health signal.'
  if (status.phase === 'running' && status.health === 'healthy') return 'Running and connected.'
  if (status.phase === 'degraded') return status.detail ?? 'The connector state could not be reconciled.'
  return status.detail ?? `Connector is ${status.phase}.`
}

export function CloudflaredRuntimePanel({
  nodeId,
  settings,
  onSettings
}: {
  nodeId: string
  settings?: CloudflaredRuntimeSettings
  onSettings: (next: CloudflaredRuntimeSettings) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<CloudflaredRuntimeStatus | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const effective = settings ?? DEFAULTS
  const isWindows = useMemo(() => /Windows/i.test(navigator.userAgent), [])

  useEffect(() => {
    let live = true
    void window.nodeTerminal.cloudflared.status(nodeId, effective.runtime).then((next) => { if (live) setStatus(next) }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    const off = window.nodeTerminal.cloudflared.onStatus((event) => { if (live && event.nodeId === nodeId) setStatus(event.status) })
    return () => { live = false; off() }
  }, [nodeId, effective.runtime])

  const patch = (next: Partial<CloudflaredRuntimeSettings>) => onSettings({ ...effective, ...next })
  const storeToken = async () => {
    setBusy(true); setError('')
    try {
      const result = await window.nodeTerminal.cloudflared.setToken(nodeId, token)
      if (!result.ok) setError(result.error)
      else setToken('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const start = async () => {
    setBusy(true); setError('')
    try { setStatus(await window.nodeTerminal.cloudflared.start(nodeId, effective)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const stop = async () => {
    setBusy(true); setError('')
    try { setStatus(await window.nodeTerminal.cloudflared.stop(nodeId)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const installService = async () => {
    setBusy(true); setError('')
    try { setStatus(await window.nodeTerminal.cloudflared.installWindowsService(nodeId, { ...effective, runtime: 'windows-service' })) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const clear = async () => {
    setBusy(true); setError('')
    try { await window.nodeTerminal.cloudflared.clearToken(nodeId); setStatus(await window.nodeTerminal.cloudflared.status(nodeId, effective.runtime)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const uninstall = () => {
    const opened = openDestructiveGate({
      title: 'Uninstall Cloudflared connector',
      description: 'This stops the local connector and removes its protected token file. It does not delete provider tunnels or project files.',
      affected: [nodeId],
      confirmLabel: 'Uninstall connector',
      onConfirm: () => {
        setBusy(true); setError('')
        void window.nodeTerminal.cloudflared.uninstall(nodeId).then((result) => {
          if (!result.ok) setError(result.error)
          return window.nodeTerminal.cloudflared.status(nodeId, effective.runtime)
        }).then(setStatus).catch((e) => setError(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false))
      }
    })
    if (!opened) setError('Another destructive confirmation is already open. Close it before uninstalling this connector.')
  }

  return (
    <div className="service-node__body cloudflared-runtime" aria-label="Cloudflared connector runtime">
      <p className="service-node__state">{phaseText(status)}</p>
      <p className="service-node__note">The token is stored in a protected local file. It never enters the project canvas, logs, command arguments, or environment.</p>
      <label className="service-node__field" htmlFor={`${nodeId}-cloudflared-token`}>
        <span className="service-node__field-label">Connector token</span>
        <div className="service-node__field-row">
          <Input id={`${nodeId}-cloudflared-token`} className="service-node__input nodrag" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste a token to store locally" />
          <Button disabled={busy || !token.trim()} onClick={() => void storeToken()}>Store token</Button>
        </div>
      </label>
      <label className="service-node__field" htmlFor={`${nodeId}-cloudflared-origin`}>
        <span className="service-node__field-label">Origin URL</span>
        <Input id={`${nodeId}-cloudflared-origin`} className="service-node__input nodrag" type="url" value={effective.origin} onChange={(e) => patch({ origin: e.target.value })} />
      </label>
      <div className="cloudflared-runtime__choices" role="group" aria-label="Connector runtime">
        {(['process', 'windows-service', 'docker'] as CloudflaredRuntimeKind[]).map((runtime) => (
          <Button key={runtime} aria-pressed={effective.runtime === runtime} disabled={runtime === 'windows-service' && !isWindows} onClick={() => patch({ runtime })}>
            {runtime === 'process' ? 'Per-user process' : runtime === 'windows-service' ? 'Windows service' : 'Docker connector'}
          </Button>
        ))}
      </div>
      {effective.runtime === 'docker' && (
        <>
          <label className="service-node__field" htmlFor={`${nodeId}-cloudflared-image`}><span className="service-node__field-label">Official image tag or digest</span><Input id={`${nodeId}-cloudflared-image`} className="service-node__input nodrag" value={effective.image} onChange={(e) => patch({ image: e.target.value })} /></label>
          <div className="cloudflared-runtime__limits">
            <label>CPU<Input type="number" min={0.25} max={4} step={0.25} value={effective.cpus} onChange={(e) => patch({ cpus: Number(e.target.value) })} /></label>
            <label>Memory MB<Input type="number" min={128} max={4096} step={128} value={effective.memoryMb} onChange={(e) => patch({ memoryMb: Number(e.target.value) })} /></label>
            <label>PIDs<Input type="number" min={32} max={1024} step={32} value={effective.pidsLimit} onChange={(e) => patch({ pidsLimit: Number(e.target.value) })} /></label>
          </div>
          <p className="service-node__note">Docker uses a verified digest, a read-only root, a read-only token mount, no-new-privileges, all capabilities dropped, bridge networking only, bounded resources, no privileged mode, and no Docker socket.</p>
        </>
      )}
      <div className="cloudflared-runtime__actions">
        <Button variant="primary" disabled={busy} onClick={() => void start()}>Start connector</Button>
        <Button disabled={busy || status?.phase !== 'running'} onClick={() => void stop()}>Stop connector</Button>
        {isWindows && <Button disabled={busy} onClick={() => void installService()}>Install Windows service (UAC)</Button>}
        <Button disabled={busy} onClick={() => void clear()}>Clear local token</Button>
        <Button danger disabled={busy} onClick={uninstall}>Uninstall connector</Button>
      </div>
      {status?.recentLog.length ? <pre className="cloudflared-runtime__log" aria-label="Recent redacted connector log">{status.recentLog.join('\n')}</pre> : null}
      {error ? <p className="service-node__note mc-note--warn" role="alert">{error}</p> : null}
    </div>
  )
}
