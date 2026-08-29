import { useEffect, useMemo, useRef, useState } from 'react'
import { OPEN_WEBUI_DEFAULT_PORT, type OpenWebUiBackupSummary, type OpenWebUiConfigureInput, type OpenWebUiStatus } from '@shared/open-webui'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { useRegexSearchField } from '../../lib/regex/useRegexSearchField'

const EMPTY_PROVIDER: OpenWebUiConfigureInput['provider'] = { kind: 'ollama' }

/** A guided Open WebUI host surface. Every action delegates to the typed local core API. */
export function OpenWebUiPanel({ nodeId }: { nodeId: string }): React.JSX.Element {
  const [status, setStatus] = useState<OpenWebUiStatus | null>(null)
  const [contexts, setContexts] = useState<Array<{ name: string; current: boolean; endpoint: string }>>([])
  const [context, setContext] = useState('')
  const [port, setPort] = useState(String(OPEN_WEBUI_DEFAULT_PORT))
  const [provider, setProvider] = useState<'ollama' | 'openai-compatible'>('ollama')
  const [providerUrl, setProviderUrl] = useState('')
  const [credentialKey, setCredentialKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const search = useRegexSearchField({ mode: 'text' })
  const searchInputRef = useRef<HTMLInputElement>(null)

  const refresh = (): void => { void window.nodeTerminal.openWebUi.status(nodeId).then(setStatus).catch((error) => setMessage(error instanceof Error ? error.message : String(error))) }
  useEffect(() => {
    refresh()
    void window.nodeTerminal.relayHost.dockerContexts().then(setContexts).catch(() => setContexts([]))
    const unsubscribe = window.nodeTerminal.openWebUi.onEvent((next) => {
      if (next.id === nodeId) setStatus(next)
    })
    const timer = window.setInterval(refresh, 5000)
    return () => { window.clearInterval(timer); unsubscribe() }
  }, [nodeId])

  const filteredContexts = useMemo(() => {
    const query = search.value.trim().toLocaleLowerCase()
    return query ? contexts.filter((item) => search.test(`${item.name} ${item.endpoint}`)) : contexts
  }, [contexts, search.value, search.test])

  const run = async (action: () => Promise<OpenWebUiStatus>): Promise<void> => {
    if (busy) return
    setBusy(true); setMessage(null)
    try { setStatus(await action()) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  const configure = (): void => {
    const input: OpenWebUiConfigureInput = {
      id: nodeId,
      context,
      port: Number(port),
      reuseExistingOllama: provider === 'ollama',
      provider: provider === 'ollama' ? EMPTY_PROVIDER : { kind: provider, ...(providerUrl ? { endpoint: providerUrl } : {}), ...(credentialKey ? { credentialKey } : {}) }
    }
    void run(() => window.nodeTerminal.openWebUi.configure(input))
  }

  const actionLabel = status?.phase === 'ready' || status?.phase === 'awaiting-first-user' ? 'Restart' : 'Start privately'

  return (
    <div className="service-node__body open-webui-panel" role="region" aria-label="Open WebUI hosting">
      <p className="service-node__state">{status?.phase === 'awaiting-first-user' ? 'Ready for the first user' : status?.phase ?? 'Checking host state…'}</p>
      <p className="service-node__note">The official pinned image runs privately on loopback with persistent data. The first person who registers in Open WebUI becomes its owner; nodeterm never creates that account.</p>
      <div className="open-webui-panel__search">
        <label className="service-node__field" htmlFor={`${nodeId}-openwebui-search`}>
          <span className="service-node__field-label">Search Docker contexts</span>
          <div className="regex-search-field">
            <input ref={searchInputRef} id={`${nodeId}-openwebui-search`} className="service-node__input nodrag" value={search.value} onChange={(event) => search.setValue(event.target.value)} placeholder="Current context" />
            <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex builder for Docker context search" />
          </div>
        </label>
      </div>
      <label className="service-node__field" htmlFor={`${nodeId}-openwebui-context`}>
        <span className="service-node__field-label">Docker context</span>
        <select id={`${nodeId}-openwebui-context`} className="service-node__input nodrag" value={context} onChange={(event) => setContext(event.target.value)} disabled={busy}>
          <option value="">Current context</option>
          {filteredContexts.map((item) => <option key={item.name} value={item.name}>{item.name}{item.current ? ' · current' : ''}</option>)}
        </select>
      </label>
      <label className="service-node__field" htmlFor={`${nodeId}-openwebui-port`}>
        <span className="service-node__field-label">Private host port</span>
        <input id={`${nodeId}-openwebui-port`} className="service-node__input nodrag" type="number" min={1024} max={65535} value={port} onChange={(event) => setPort(event.target.value)} disabled={busy} />
      </label>
      <fieldset className="open-webui-panel__providers">
        <legend>Model provider</legend>
        <label><input type="radio" checked={provider === 'ollama'} onChange={() => setProvider('ollama')} disabled={busy} /> Reuse existing local Ollama</label>
        <label><input type="radio" checked={provider === 'openai-compatible'} onChange={() => setProvider('openai-compatible')} disabled={busy} /> OpenAI-compatible endpoint</label>
      </fieldset>
      {provider === 'openai-compatible' && <>
        <label className="service-node__field" htmlFor={`${nodeId}-openwebui-provider-url`}><span className="service-node__field-label">Provider HTTPS address</span><input id={`${nodeId}-openwebui-provider-url`} className="service-node__input nodrag" value={providerUrl} onChange={(event) => setProviderUrl(event.target.value)} placeholder="https://provider.example/v1" disabled={busy} /></label>
        <label className="service-node__field" htmlFor={`${nodeId}-openwebui-credential`}><span className="service-node__field-label">OS credential reference</span><input id={`${nodeId}-openwebui-credential`} className="service-node__input nodrag" value={credentialKey} onChange={(event) => setCredentialKey(event.target.value)} placeholder="Vault entry name, not the key" disabled={busy} /></label>
        <p className="service-node__note">Only the opaque credential reference is stored. The key itself never enters the canvas file, Docker arguments, or logs.</p>
      </>}
      <div className="open-webui-panel__actions">
        <button type="button" className="button-component" onClick={configure} disabled={busy}>Save host settings</button>
        <button type="button" className="button-component" onClick={() => void run(() => window.nodeTerminal.openWebUi.start(nodeId))} disabled={busy || !status}>▶ {actionLabel}</button>
        <button type="button" className="button-component" onClick={() => void run(() => window.nodeTerminal.openWebUi.stop(nodeId))} disabled={busy || status?.containerState !== 'running'}>Stop</button>
      </div>
      <div className="open-webui-panel__actions">
        <button type="button" className="button-component" onClick={() => void run(() => window.nodeTerminal.openWebUi.createBackup(nodeId))} disabled={busy || !status || status.phase === 'unconfigured'}>Back up data</button>
        <button type="button" className="button-component" onClick={() => void run(() => window.nodeTerminal.openWebUi.update(nodeId))} disabled={busy || !status || status.phase === 'unconfigured'}>Update pinned image</button>
        <button type="button" className="button-component" onClick={() => void run(() => window.nodeTerminal.openWebUi.rollback(nodeId))} disabled={busy || !status || !status.backups.some((backup) => backup.automatic)}>Rollback</button>
        <button type="button" className="button-component" onClick={() => void window.nodeTerminal.openWebUi.tunnelHandoff(nodeId).then((result) => setMessage(result.reason))} disabled={busy || status?.health !== 'ready'}>Prepare private tunnel handoff</button>
      </div>
      <p className="service-node__note">Image: <code>ghcr.io/open-webui/open-webui:v0.8.3</code> · data: <code>{status?.dataVolume ?? 'not created'}</code> · health: {status?.health ?? 'unknown'}</p>
      {status?.backups.length ? <div className="open-webui-panel__backups"><strong>Backups</strong>{status.backups.map((backup: OpenWebUiBackupSummary) => <span key={backup.id}>{backup.id} · {backup.sizeBytes} bytes{backup.automatic ? ' · automatic' : ''}</span>)}</div> : null}
      {message && <p className="service-node__note mc-note--warn" role="status">{message}</p>}
    </div>
  )
}
