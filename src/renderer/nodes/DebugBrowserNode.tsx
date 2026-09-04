import { useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import {
  DEBUG_BROWSER_SCHEMES,
  debugBrowserProxyLabel,
  normalizeDebugBrowserProxy,
  normalizeDebugBrowserSpec,
  type DebugBrowserProxy,
  type DebugBrowserSpec,
  type DebugBrowserSessionSummary
} from '@shared/browser-debug'
import type { NodeTerminalApi } from '@shared/types'
import type { CanvasNode } from '../state/workspace'

const DEFAULT_SPEC: DebugBrowserSpec = {
  version: 1,
  label: 'Debug browser',
  startUrl: 'https://example.com'
}

function api(): NodeTerminalApi['debugBrowser'] {
  return window.nodeTerminal.debugBrowser
}

function displayState(session: DebugBrowserSessionSummary | null): string {
  if (!session) return 'Not started'
  if (session.state === 'error') return `Error: ${session.error ?? 'The session stopped before it became ready.'}`
  return session.state[0].toUpperCase() + session.state.slice(1)
}

export default function DebugBrowserNode({ id, data, selected }: NodeProps<CanvasNode>): React.JSX.Element {
  const { updateNodeData, deleteElements } = useReactFlow()
  const spec = useMemo(
    () => normalizeDebugBrowserSpec(data.debugBrowserSpec) ?? DEFAULT_SPEC,
    [data.debugBrowserSpec]
  )
  const [executables, setExecutables] = useState<Awaited<ReturnType<NonNullable<NodeTerminalApi['debugBrowser']>['listExecutables']>>>([])
  const [session, setSession] = useState<DebugBrowserSessionSummary | null>(null)
  const [error, setError] = useState('')
  const [proxyEnabled, setProxyEnabled] = useState(!!spec.proxy)
  const [labelInput, setLabelInput] = useState(spec.label)
  const [urlInput, setUrlInput] = useState(spec.startUrl)
  const [proxyHostInput, setProxyHostInput] = useState(spec.proxy?.host ?? '127.0.0.1')
  const [proxyPortInput, setProxyPortInput] = useState(String(spec.proxy?.port ?? 8080))
  const [executablePath, setExecutablePath] = useState('')
  const sessionRef = useRef<DebugBrowserSessionSummary | null>(null)
  sessionRef.current = session

  useEffect(() => {
    setLabelInput(spec.label)
    setUrlInput(spec.startUrl)
    setProxyHostInput(spec.proxy?.host ?? '127.0.0.1')
    setProxyPortInput(String(spec.proxy?.port ?? 8080))
  }, [spec])

  useEffect(() => {
    let live = true
    const service = api()
    if (service) {
      void service.listExecutables().then((items) => {
        if (live) {
          setExecutables(items)
          setExecutablePath(items[0]?.path ?? '')
        }
      }).catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Browser discovery failed.')
      })
    }
    return () => {
      live = false
    }
  }, [])

  useEffect(() => () => {
    const current = sessionRef.current
    if (current) void api()?.stop(current.sessionId)
  }, [])

  const patchSpec = (patch: Partial<DebugBrowserSpec>): void => {
    const next = normalizeDebugBrowserSpec({ ...spec, ...patch })
    if (!next) return
    updateNodeData(id, { debugBrowserSpec: next, title: next.label })
  }

  const patchProxy = (patch: Partial<DebugBrowserProxy>): void => {
    const next = normalizeDebugBrowserProxy({ ...(spec.proxy ?? { scheme: 'http', host: '127.0.0.1', port: 8080 }), ...patch })
    if (!next) return
    patchSpec({ proxy: next })
  }

  const start = async (): Promise<void> => {
    const service = api()
    if (!service) {
      setError('Isolated debugging browser sessions are available only in the desktop app.')
      return
    }
    setError('')
    const result = await service.start(spec, executablePath || undefined)
    if (result.ok) setSession(result.session)
    else setError(result.error)
  }

  const stop = async (): Promise<void> => {
    if (!session) return
    await api()?.stop(session.sessionId)
    setSession(null)
  }

  const inspect = async (): Promise<void> => {
    if (!session) return
    const result = await api()?.inspect(session.sessionId)
    if (result?.ok) setSession(result.session)
    else setError(result?.error ?? 'The CDP inspection service is unavailable.')
  }

  return (
    <div className={`term-node debug-browser-node${selected ? ' selected' : ''}`}>
      <NodeResizer minWidth={420} minHeight={300} isVisible={selected} color="var(--md-primary)" />
      <div className="term-node__header">
        <span className="term-node__title-text">{spec.label}</span>
        <span className="term-node__spacer" />
        <button className="term-node__close" title="Close" onClick={() => deleteElements({ nodes: [{ id }] })}>×</button>
      </div>
      <div className="debug-browser-node__body">
        <p className="debug-browser-node__status" role="status">
          <strong>Isolated debugging browser</strong>: {displayState(session)}
        </p>
        <label>
          Browser
          <select value={executablePath} onChange={(event) => setExecutablePath(event.target.value)}>
            {executables.map((item) => <option key={item.path} value={item.path}>{item.label}</option>)}
          </select>
        </label>
        <label>
          Session name
          <input value={labelInput} maxLength={160} onChange={(event) => setLabelInput(event.target.value)} onBlur={() => patchSpec({ label: labelInput })} />
        </label>
        <label>
          Start URL
          <input value={urlInput} inputMode="url" onChange={(event) => setUrlInput(event.target.value)} onBlur={() => patchSpec({ startUrl: urlInput })} />
        </label>
        <label className="debug-browser-node__check">
          <input
            type="checkbox"
            checked={proxyEnabled}
            onChange={(event) => {
              setProxyEnabled(event.target.checked)
              if (event.target.checked) patchProxy({})
              else patchSpec({ proxy: undefined })
            }}
          />
          Use a validated proxy
        </label>
        {proxyEnabled && (
          <div className="debug-browser-node__proxy">
            <label>
              Scheme
              <select value={spec.proxy?.scheme ?? 'http'} onChange={(event) => patchProxy({ scheme: event.target.value as DebugBrowserProxy['scheme'] })}>
                {DEBUG_BROWSER_SCHEMES.map((scheme) => <option key={scheme} value={scheme}>{scheme}</option>)}
              </select>
            </label>
            <label>
              Host
              <input value={proxyHostInput} onChange={(event) => setProxyHostInput(event.target.value)} onBlur={() => patchProxy({ host: proxyHostInput })} />
            </label>
            <label>
              Port
              <input type="number" min={1} max={65535} value={proxyPortInput} onChange={(event) => setProxyPortInput(event.target.value)} onBlur={() => patchProxy({ port: Number(proxyPortInput) })} />
            </label>
          </div>
        )}
        <p className="debug-browser-node__hint">
          {spec.proxy ? `Proxy: ${debugBrowserProxyLabel(spec.proxy)}.` : 'Direct connection.'} A fresh profile is created for each run. Normal browser profiles and credentials are never reused.
        </p>
        {executables.length === 0 && <p className="debug-browser-node__warning">No supported Chromium browser was detected on this computer, so Start is unavailable.</p>}
        {error && <p className="debug-browser-node__error">{error}</p>}
        <div className="debug-browser-node__actions">
          {!session ? <button disabled={executables.length === 0 || !executablePath} onClick={() => void start()}>Start isolated session</button> : <button onClick={() => void stop()}>Stop session</button>}
          {session && <button onClick={() => void inspect()}>Refresh CDP target</button>}
        </div>
        {session?.endpoint && <p className="debug-browser-node__endpoint">CDP: {session.endpoint} (loopback only)</p>}
      </div>
    </div>
  )
}
