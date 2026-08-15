import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  isValidModelRef,
  type FitEvaluation,
  type HardwareEvidence,
  type OllamaChatSession,
  type OllamaChatSessionSummary,
  type OllamaApi,
  type OllamaModelInfo,
  type OllamaRunningModel,
  type OllamaStatus,
  type PullQueueItem,
  type PullQueueState
} from '@shared/ollama'
import { E_UNSUPPORTED } from '@shared/rpc'
import { formatBytes } from '../../lib/bytesFormat'
import { useActiveSessionApi } from '../../session/session'
import { ConfirmDialog } from '../ConfirmDialog'
import { promptDialog } from '../promptDialog'
import { troubleshootSteps } from './troubleshoot'

export interface OllamaManagerPanelProps {
  onClose: () => void
}

type Tab = 'health' | 'models' | 'store' | 'chat'
type ActiveSessionApi = ReturnType<typeof useActiveSessionApi>

const PANEL_SCOPE_KEYS = new WeakMap<ActiveSessionApi, number>()
let nextPanelScopeKey = 1

function panelScopeKey(api: ActiveSessionApi): number {
  const known = PANEL_SCOPE_KEYS.get(api)
  if (known !== undefined) return known
  const key = nextPanelScopeKey++
  PANEL_SCOPE_KEYS.set(api, key)
  return key
}

interface RouteError {
  code: string | null
  message: string
}

interface ModelDeleteTarget {
  model: string
  api: ActiveSessionApi
}

const CHAT_SCOPE_KEYS = new WeakMap<OllamaApi, number>()
let nextChatScopeKey = 1

/** React state belongs to one Ollama core. A new api identity must remount ChatTab so an old
 * session id can never be offered to the newly active core by send/rename/delete. */
function chatScopeKey(ollama: OllamaApi): number {
  const known = CHAT_SCOPE_KEYS.get(ollama)
  if (known !== undefined) return known
  const key = nextChatScopeKey++
  CHAT_SCOPE_KEYS.set(ollama, key)
  return key
}

function routeError(error: unknown): RouteError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null
  if (code === E_UNSUPPORTED) {
    return {
      code,
      message:
        'Ollama is not available for this remote project session. The manager will not fall back to this computer.'
    }
  }
  const detail = error instanceof Error ? error.message : String(error)
  return { code, message: `Could not load Ollama for this project session: ${detail}` }
}

const toast = (message: string, kind: 'error' | 'info' = 'info'): void => {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind, message } }))
}

function FitBadge({ fit }: { fit: FitEvaluation | undefined }) {
  if (!fit) return <span className="om-fit om-fit--unknown">Unknown</span>
  const label =
    fit.verdict === 'runs-well'
      ? 'Runs well'
      : fit.verdict === 'runs-with-limits'
        ? 'Runs with limits'
        : fit.verdict === 'unlikely'
          ? 'Unlikely'
          : 'Unknown'
  return <span className={`om-fit om-fit--${fit.verdict}`}>{label}</span>
}

function FitDetail({ fit }: { fit: FitEvaluation | undefined }) {
  if (!fit) return null
  return (
    <div className="om-fit-detail">
      <ul>
        {fit.evidence.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
        {fit.assumptions.map((a, i) => (
          <li key={`a-${i}`}>Assumption: {a}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Local Ollama suite manager — docs/ollama-manager.md. Talks only to Ollama's own local HTTP API
 * (via the privileged main/server process — see core/ollama/*). Health/troubleshoot, installed-
 * model browser with evidence-backed hardware fit, a batch-pull "cart" (never money), and a
 * streaming chat surface.
 *
 * Known gaps versus the full house contract, left for a follow-up (see docs/ollama-manager.md):
 * the Model Store here is a small curated "popular models" seed plus free-text entry, not an
 * exhaustive paginated mirror of Ollama's official catalog; image attachments are gated correctly
 * but not actually implemented (the control stays visibly disabled with the real reason); and the
 * search boxes are plain substring search, not the full anchored regex builder.
 */
export function OllamaManagerPanel(props: OllamaManagerPanelProps) {
  // Ollama runs on the machine that owns the active project. In particular, a relay tab must use
  // its deliberately-unsupported session api rather than silently managing this computer's models.
  const api = useActiveSessionApi()
  // Remount during the switch render, before passive effects. Otherwise a stale model/cart row can
  // be briefly committed with callbacks from the newly active machine.
  return <OllamaManagerPanelForApi key={panelScopeKey(api)} {...props} api={api} />
}

function OllamaManagerPanelForApi({
  onClose,
  api
}: OllamaManagerPanelProps & { api: ActiveSessionApi }) {
  const ollama = api.ollama
  const apiRef = useRef(api)
  const mountedRef = useRef(true)
  apiRef.current = api
  const [tab, setTab] = useState<Tab>('health')
  const [status, setStatus] = useState<OllamaStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [hardware, setHardware] = useState<HardwareEvidence | null>(null)
  const [models, setModels] = useState<OllamaModelInfo[]>([])
  const [running, setRunning] = useState<OllamaRunningModel[]>([])
  const [popular, setPopular] = useState<{ name: string; note: string }[]>([])
  const [fitMap, setFitMap] = useState<Record<string, FitEvaluation>>({})
  const [storeQuery, setStoreQuery] = useState('')
  const [customRef, setCustomRef] = useState('')
  const [cart, setCart] = useState<PullQueueItem[]>([])
  const [cartSummary, setCartSummary] = useState<Pick<PullQueueState, 'running' | 'concurrency'>>({
    running: false,
    concurrency: 1
  })
  const [deleteTarget, setDeleteTarget] = useState<ModelDeleteTarget | null>(null)
  const [accessError, setAccessError] = useState<RouteError | null>(null)

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    []
  )

  const apiStillActive = useCallback(
    (candidate: ActiveSessionApi): boolean => mountedRef.current && apiRef.current === candidate,
    []
  )

  const refreshStatus = useCallback(async () => {
    if (!apiStillActive(api)) return
    setChecking(true)
    setAccessError(null)
    try {
      const s = await ollama.status()
      if (!apiStillActive(api)) return
      setStatus(s)
      if (s.health === 'ok') {
        const [m, r, hw] = await Promise.all([
          ollama.models(),
          ollama.running(),
          ollama.hardware()
        ])
        if (!apiStillActive(api)) return
        setModels(m)
        setRunning(r)
        setHardware(hw)
      } else {
        const hw = await ollama.hardware().catch(() => null)
        if (!apiStillActive(api)) return
        setHardware(hw)
      }
    } catch (error) {
      if (!apiStillActive(api)) return
      setStatus(null)
      setHardware(null)
      setModels([])
      setRunning([])
      setAccessError(routeError(error))
    } finally {
      if (apiStillActive(api)) setChecking(false)
    }
  }, [api, apiStillActive, ollama])

  useEffect(() => {
    let live = true
    setStatus(null)
    setHardware(null)
    setModels([])
    setRunning([])
    setPopular([])
    setFitMap({})
    setCart([])
    setCartSummary({ running: false, concurrency: 1 })
    // A confirmation is authority for exactly the api/model pair that opened it. On a project
    // switch, retaining it would let its model name cross into the next machine's delete call.
    setDeleteTarget(null)
    setAccessError(null)
    void refreshStatus()
    void ollama
      .popularModels()
      .then((models) => live && setPopular(models))
      .catch(() => {})
    void ollama
      .pullState()
      .then((s) => {
        if (!live) return
        setCart(s.items)
        setCartSummary({ running: s.running, concurrency: s.concurrency })
      })
      .catch(() => {})
    const offItem = ollama.onPullItem((item) => {
      if (!live) return
      setCart((prev) => {
        const idx = prev.findIndex((i) => i.id === item.id)
        if (idx === -1) return [...prev, item]
        const copy = [...prev]
        copy[idx] = item
        return copy
      })
    })
    const offSummary = ollama.onPullSummary((summary) => {
      if (live) setCartSummary(summary)
    })
    return () => {
      live = false
      offItem()
      offSummary()
    }
  }, [ollama, refreshStatus])

  // Recompute fit whenever the set of names we care about changes (installed + popular + cart refs).
  useEffect(() => {
    if (status?.health !== 'ok') return
    const refs = new Set<string>()
    for (const m of models) refs.add(m.name)
    for (const p of popular) refs.add(p.name)
    for (const c of cart) refs.add(c.ref)
    if (refs.size === 0) return
    ollama
      .fit([...refs])
      .then((fit) => {
        if (apiStillActive(api)) setFitMap(fit)
      })
      .catch(() => {})
  }, [models, popular, cart, status?.health, api, apiStillActive, ollama])

  const filteredPopular = useMemo(() => {
    const q = storeQuery.trim().toLowerCase()
    if (!q) return popular
    return popular.filter((p) => p.name.toLowerCase().includes(q) || p.note.toLowerCase().includes(q))
  }, [popular, storeQuery])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || deleteTarget.api !== api || !apiStillActive(api)) {
      setDeleteTarget((current) => (current === deleteTarget ? null : current))
      return
    }
    const target = deleteTarget
    const model = target.model
    try {
      await target.api.ollama.deleteModel(model)
      if (!apiStillActive(target.api)) return
      toast(`Deleted ${model}.`)
      void refreshStatus()
    } catch (e) {
      if (!apiStillActive(target.api)) return
      toast(`Could not delete ${model}: ${(e as Error).message}`, 'error')
    } finally {
      // A newly-active project may already have opened its own confirmation while this request was
      // in flight. Completion owns only the exact target object that launched it.
      setDeleteTarget((current) => (current === target ? null : current))
    }
  }, [api, apiStillActive, deleteTarget, refreshStatus])

  const handleAddCustomRef = useCallback(async () => {
    const ref = customRef.trim()
    if (!isValidModelRef(ref)) {
      toast('Not a valid model reference — use "name" or "name:tag".', 'error')
      return
    }
    const result = await ollama.pullEnqueue([ref])
    if (result.rejected.length > 0) toast(result.rejected[0].error, 'error')
    else {
      toast(`Added ${ref} to the pull queue.`)
      setCustomRef('')
    }
  }, [customRef, ollama])

  const handleAddToCart = useCallback(async (ref: string) => {
    const result = await ollama.pullEnqueue([ref])
    if (result.rejected.length > 0) toast(result.rejected[0].error, 'error')
    else toast(`Added ${ref} to the pull queue.`)
  }, [ollama])

  const cartEstimate = useMemo(() => {
    let known = 0
    let unknownCount = 0
    for (const item of cart) {
      if (item.status === 'done' || item.status === 'cancelled') continue
      if (item.totalBytes !== null) known += item.totalBytes
      else unknownCount++
    }
    return { known, unknownCount }
  }, [cart])

  return createPortal(
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer ollama" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ollama manager">
        <div className="drawer__head">
          <h2>Ollama manager</h2>
          <button className="drawer__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="drawer__body om-body">
          {accessError ? (
            <section className="om-empty-note" role="alert">
              <p>{accessError.message}</p>
              {accessError.code && (
                <p>
                  Refusal code: <code>{accessError.code}</code>
                </p>
              )}
              {accessError.code !== E_UNSUPPORTED && (
                <button className="sc-btn" onClick={() => void refreshStatus()} disabled={checking}>
                  Retry
                </button>
              )}
            </section>
          ) : (
            <>
              <div className="om-tabs" role="tablist">
                {(['health', 'models', 'store', 'chat'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    className={`om-tab${tab === t ? ' om-tab--active' : ''}`}
                    onClick={() => setTab(t)}
                  >
                    {t === 'health' ? 'Health' : t === 'models' ? 'Installed' : t === 'store' ? 'Model store' : 'Chat'}
                  </button>
                ))}
              </div>

              {tab === 'health' && (
                <HealthTab
                  status={status}
                  checking={checking}
                  hardware={hardware}
                  running={running}
                  onRefresh={refreshStatus}
                />
              )}

              {tab === 'models' && (
                <ModelsTab
                  status={status}
                  models={models}
                  fitMap={fitMap}
                  onDelete={(model) => setDeleteTarget({ model, api })}
                  onRefresh={refreshStatus}
                />
              )}

              {tab === 'store' && (
                <StoreTab
                  ollama={ollama}
                  status={status}
                  storeQuery={storeQuery}
                  setStoreQuery={setStoreQuery}
                  filteredPopular={filteredPopular}
                  fitMap={fitMap}
                  customRef={customRef}
                  setCustomRef={setCustomRef}
                  onAddCustomRef={handleAddCustomRef}
                  onAddToCart={handleAddToCart}
                  cart={cart}
                  cartSummary={cartSummary}
                  cartEstimate={cartEstimate}
                />
              )}

              {tab === 'chat' && (
                <ChatTab key={chatScopeKey(ollama)} ollama={ollama} status={status} models={models} />
              )}
            </>
          )}
        </div>
      </aside>
      {deleteTarget?.api === api && (
        <ConfirmDialog
          message={`Delete the installed model "${deleteTarget.model}"? This removes its blobs from disk.`}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>,
    document.body
  )
}

function HealthTab({
  status,
  checking,
  hardware,
  running,
  onRefresh
}: {
  status: OllamaStatus | null
  checking: boolean
  hardware: HardwareEvidence | null
  running: OllamaRunningModel[]
  onRefresh: () => void
}) {
  const ok = status?.health === 'ok'
  const dotClass = checking ? 'checking' : ok ? 'ok' : status ? 'bad' : ''
  return (
    <section>
      <div className="om-health">
        <span className={`om-health__dot om-health__dot--${dotClass}`} aria-hidden />
        <span>
          {checking
            ? 'Checking…'
            : !status
              ? 'Not checked yet'
              : status.health === 'ok'
                ? `Running — Ollama ${status.version ?? 'unknown version'} at ${status.endpoint}`
                : status.health === 'not-installed'
                  ? 'Ollama does not appear to be installed'
                  : status.health === 'stopped'
                    ? `Ollama is not running at ${status.endpoint} (connection refused)`
                    : status.health === 'unreachable'
                      ? `Could not reach Ollama at ${status.endpoint}`
                      : `Ollama answered but reported a problem: ${status.detail ?? 'unknown error'}`}
        </span>
        <button className="sc-btn" onClick={onRefresh} disabled={checking}>
          Retry
        </button>
      </div>

      {hardware && (
        <p className="om-hardware">
          {formatBytes(hardware.totalRamBytes)} RAM total ({formatBytes(hardware.freeRamBytes)} free) ·{' '}
          {hardware.gpuName ? `GPU: ${hardware.gpuName}` : 'No GPU detected'}
          {hardware.vramBytes !== null && ` (${formatBytes(hardware.vramBytes)} VRAM)`} · Free disk:{' '}
          {formatBytes(hardware.freeDiskBytes)} · {hardware.platform}/{hardware.arch}
        </p>
      )}

      {!ok && (
        <div className="om-troubleshoot">
          <p>
            <strong>Get Ollama running:</strong>
          </p>
          <ol>
            {troubleshootSteps(hardware?.platform ?? 'linux').map((step, i) => (
              <li key={i}>
                {step.label}
                {step.command && <pre>{step.command}</pre>}
              </li>
            ))}
          </ol>
          <button className="sc-btn" onClick={onRefresh}>
            I've done this — check again
          </button>
        </div>
      )}

      {ok && running.length > 0 && (
        <>
          <h3>Currently loaded</h3>
          <ul className="om-model-list">
            {running.map((m) => (
              <li key={m.name} className="om-model">
                <div className="om-model__row">
                  <span className="om-model__name">{m.name}</span>
                  <span className="om-model__meta">
                    {formatBytes(m.sizeBytes)}
                    {m.vramBytes !== null && ` · ${formatBytes(m.vramBytes)} VRAM`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function ModelsTab({
  status,
  models,
  fitMap,
  onDelete,
  onRefresh
}: {
  status: OllamaStatus | null
  models: OllamaModelInfo[]
  fitMap: Record<string, FitEvaluation>
  onDelete: (name: string) => void
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (status?.health !== 'ok') {
    return <p className="om-empty-note">Ollama is not reachable — see the Health tab.</p>
  }
  return (
    <section>
      <div className="om-actions">
        <button className="sc-btn" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      {models.length === 0 ? (
        <p className="om-empty-note">No models installed yet — pull one from the Model store tab.</p>
      ) : (
        <ul className="om-model-list">
          {models.map((m) => (
            <li key={m.name} className="om-model">
              <div className="om-model__row">
                <button
                  className="om-model__name"
                  style={{ background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit' }}
                  onClick={() => setExpanded((e) => (e === m.name ? null : m.name))}
                  aria-expanded={expanded === m.name}
                >
                  {m.name}
                </button>
                <span className="om-model__meta">
                  {formatBytes(m.sizeBytes)}
                  {m.details.parameter_size && ` · ${m.details.parameter_size}`}
                  {m.details.quantization_level && ` · ${m.details.quantization_level}`}
                </span>
                <FitBadge fit={fitMap[m.name]} />
                <button className="cv-item__link" onClick={() => onDelete(m.name)}>
                  Delete
                </button>
              </div>
              {expanded === m.name && <FitDetail fit={fitMap[m.name]} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function StoreTab({
  ollama,
  status,
  storeQuery,
  setStoreQuery,
  filteredPopular,
  fitMap,
  customRef,
  setCustomRef,
  onAddCustomRef,
  onAddToCart,
  cart,
  cartSummary,
  cartEstimate
}: {
  ollama: OllamaApi
  status: OllamaStatus | null
  storeQuery: string
  setStoreQuery: (v: string) => void
  filteredPopular: { name: string; note: string }[]
  fitMap: Record<string, FitEvaluation>
  customRef: string
  setCustomRef: (v: string) => void
  onAddCustomRef: () => void
  onAddToCart: (ref: string) => void
  cart: PullQueueItem[]
  cartSummary: Pick<PullQueueState, 'running' | 'concurrency'>
  cartEstimate: { known: number; unknownCount: number }
}) {
  return (
    <>
      <section>
        <h3>Popular models</h3>
        <p className="om-empty-note">
          A small curated starting point, not Ollama's full official catalog (see docs/ollama-manager.md) —
          enter any exact reference below if you don't see what you want.
        </p>
        <input
          type="search"
          className="om-search"
          placeholder="Search popular models…"
          aria-label="Search popular models"
          value={storeQuery}
          onChange={(e) => setStoreQuery(e.target.value)}
        />
        <ul className="om-model-list">
          {filteredPopular.map((p) => (
            <li key={p.name} className="om-model">
              <div className="om-model__row">
                <span className="om-model__name">{p.name}</span>
                <span className="om-model__meta">{p.note}</span>
                <FitBadge fit={fitMap[p.name]} />
                <button className="sc-btn" disabled={status?.health !== 'ok'} onClick={() => onAddToCart(p.name)}>
                  Add to cart
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="om-actions" style={{ marginTop: 10 }}>
          <input
            type="text"
            className="om-search"
            style={{ marginBottom: 0, flex: 1 }}
            placeholder="Exact model reference, e.g. llama3.2:1b"
            aria-label="Model reference"
            value={customRef}
            onChange={(e) => setCustomRef(e.target.value)}
          />
          <button className="sc-btn" disabled={status?.health !== 'ok' || !customRef.trim()} onClick={onAddCustomRef}>
            Add
          </button>
        </div>
      </section>

      <section>
        <h3>Pull queue (cart)</h3>
        <p className="om-empty-note">
          Downloads only — there is no price, account, or purchase here. Estimated total for pending
          items with a known size: {formatBytes(cartEstimate.known)}
          {cartEstimate.unknownCount > 0 && ` (+${cartEstimate.unknownCount} of unknown size)`}.
        </p>
        <div className="cv-queue-controls">
          <button
            className="sc-btn"
            disabled={cart.length === 0}
            onClick={() =>
              void (cartSummary.running ? ollama.pullPause() : ollama.pullStart())
            }
          >
            {cartSummary.running ? 'Pause' : 'Start'}
          </button>
          <label className="cv-concurrency">
            Parallel:
            <input
              type="number"
              min={1}
              max={3}
              value={cartSummary.concurrency}
              onChange={(e) => void ollama.pullSetConcurrency(Number(e.target.value))}
            />
          </label>
        </div>
        {cart.length === 0 ? (
          <p className="om-empty-note">The cart is empty.</p>
        ) : (
          <ul className="om-cart">
            {cart.map((item) => {
              const pct =
                item.totalBytes && item.totalBytes > 0 && item.completedBytes !== null
                  ? Math.round((item.completedBytes / item.totalBytes) * 100)
                  : null
              return (
                <li key={item.id} className={`cv-item cv-item--${item.status}`}>
                  <div className="cv-item__row">
                    <span className="cv-item__icon" aria-hidden>
                      {item.status === 'done' ? '✓' : item.status === 'failed' ? '✕' : item.status === 'running' ? '↻' : '⋯'}
                    </span>
                    <span className="cv-item__name">{item.ref}</span>
                    <span className="cv-item__size">
                      {item.completedBytes !== null ? formatBytes(item.completedBytes) : '—'}
                      {item.totalBytes !== null && ` / ${formatBytes(item.totalBytes)}`}
                    </span>
                    <span className="cv-item__status">{item.digestPhase ?? item.status}</span>
                  </div>
                  {pct !== null && (
                    <div className="cv-progress">
                      <div className="cv-progress__bar" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {item.error && <p className="cv-item__error">{item.error}</p>}
                  <div className="cv-item__actions">
                    {(item.status === 'queued' || item.status === 'running') && (
                      <button className="cv-item__link" onClick={() => void ollama.pullCancelItem(item.id)}>
                        Cancel
                      </button>
                    )}
                    {(item.status === 'failed' || item.status === 'cancelled') && (
                      <button className="cv-item__link" onClick={() => void ollama.pullRetryItem(item.id)}>
                        Retry
                      </button>
                    )}
                    {item.status !== 'running' && item.status !== 'queued' && (
                      <button className="cv-item__link" onClick={() => void ollama.pullRemoveItem(item.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

function ChatTab({
  ollama,
  status,
  models
}: {
  ollama: OllamaApi
  status: OllamaStatus | null
  models: OllamaModelInfo[]
}) {
  const [sessions, setSessions] = useState<OllamaChatSessionSummary[]>([])
  const [active, setActive] = useState<OllamaChatSession | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [composer, setComposer] = useState('')
  const [capabilities, setCapabilities] = useState<string[] | null>(null)
  const [verifyingCaps, setVerifyingCaps] = useState(false)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const refreshSessions = useCallback(() => {
    ollama.chatSessions().then(setSessions).catch(() => {})
  }, [ollama])

  useEffect(() => {
    refreshSessions()
    const off = ollama.onChatStream((evt) => {
      if (!active || evt.sessionId !== active.id) return
      if (evt.kind === 'token') setStreamingText((t) => t + (evt.delta ?? ''))
      else {
        setStreaming(false)
        setStreamingText('')
        if (evt.kind === 'error') toast(`Chat error: ${evt.error}`, 'error')
        ollama.chatGet(active.id).then((s) => s && setActive(s))
        refreshSessions()
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, ollama, refreshSessions])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [active?.messages.length, streamingText])

  const handleNewChat = useCallback(async () => {
    if (models.length === 0) {
      toast('Install a model first (Model store tab).', 'error')
      return
    }
    const s = await ollama.chatCreate(models[0].name, '')
    setActive(s)
    setCapabilities(null)
    refreshSessions()
  }, [models, ollama, refreshSessions])

  const handleSelect = useCallback(async (id: string) => {
    const s = await ollama.chatGet(id)
    setActive(s)
    setCapabilities(null)
  }, [ollama])

  const handleRename = useCallback(async () => {
    if (!active) return
    const title = await promptDialog({ message: 'Rename chat', initialValue: active.title })
    if (title === null) return
    await ollama.chatRename(active.id, title)
    setActive((a) => (a ? { ...a, title } : a))
    refreshSessions()
  }, [active, ollama, refreshSessions])

  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const handleDelete = useCallback(async () => {
    if (!active) return
    await ollama.chatDelete(active.id)
    setActive(null)
    setDeleteConfirm(false)
    refreshSessions()
  }, [active, ollama, refreshSessions])

  const handleExport = useCallback(async () => {
    if (!active) return
    const text = await ollama.chatExport(active.id, 'markdown')
    if (!text) return
    const blob = new Blob([text], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${active.title.replace(/[^\w.-]+/g, '_')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [active, ollama])

  const handleSend = useCallback(async () => {
    if (!active || !composer.trim()) return
    const text = composer
    setComposer('')
    setStreaming(true)
    setStreamingText('')
    setActive((a) => (a ? { ...a, messages: [...a.messages, { role: 'user', content: text, createdAt: Date.now() }] } : a))
    try {
      await ollama.chatSend(active.id, text)
    } catch (e) {
      toast(`Could not send: ${(e as Error).message}`, 'error')
      setStreaming(false)
    }
  }, [active, composer, ollama])

  const handleVerifyCapabilities = useCallback(async () => {
    if (!active) return
    setVerifyingCaps(true)
    try {
      const info = await ollama.show(active.model)
      setCapabilities(info.capabilities ?? [])
    } finally {
      setVerifyingCaps(false)
    }
  }, [active, ollama])

  if (status?.health !== 'ok') return <p className="om-empty-note">Ollama is not reachable — see the Health tab.</p>

  const hasVision = capabilities?.includes('vision') ?? false
  const attachmentReason = !active
    ? 'Start a chat first'
    : capabilities === null
      ? 'This model\'s capabilities have not been verified yet'
      : !hasVision
        ? `"${active.model}" has no verified vision capability`
        : 'Image attachments are not implemented in this build yet'

  return (
    <section className="om-chat">
      <div className="om-actions">
        <button className="sc-btn" onClick={() => void handleNewChat()}>
          New chat
        </button>
        {active && (
          <>
            <button className="sc-btn" onClick={() => void handleRename()}>
              Rename
            </button>
            <button className="sc-btn" onClick={() => void handleExport()}>
              Export (Markdown)
            </button>
            <button className="cv-item__link" onClick={() => setDeleteConfirm(true)}>
              Delete
            </button>
          </>
        )}
      </div>
      {sessions.length > 0 && (
        <div className="om-chat__sessions">
          {sessions.map((s) => (
            <button
              key={s.id}
              className={`om-chat__session${active?.id === s.id ? ' om-chat__session--active' : ''}`}
              onClick={() => void handleSelect(s.id)}
            >
              {s.title} ({s.messageCount})
            </button>
          ))}
        </div>
      )}

      {!active ? (
        <p className="om-empty-note">No chat open. Start a new one.</p>
      ) : (
        <>
          <div className="om-actions">
            <label>
              Model:{' '}
              <select
                value={active.model}
                onChange={async (e) => {
                  const model = e.target.value
                  setActive((a) => (a ? { ...a, model } : a))
                  setCapabilities(null)
                }}
              >
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="om-chat__params">
            <label>
              Temperature:{' '}
              <input
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={active.params.temperature}
                onChange={(e) =>
                  setActive((a) => (a ? { ...a, params: { ...a.params, temperature: Number(e.target.value) } } : a))
                }
              />
            </label>
            <label>
              Top-p:{' '}
              <input
                type="number"
                step={0.05}
                min={0}
                max={1}
                value={active.params.topP}
                onChange={(e) => setActive((a) => (a ? { ...a, params: { ...a.params, topP: Number(e.target.value) } } : a))}
              />
            </label>
            <label>
              Context:{' '}
              <input
                type="number"
                step={512}
                min={512}
                value={active.params.numCtx}
                onChange={(e) => setActive((a) => (a ? { ...a, params: { ...a.params, numCtx: Number(e.target.value) } } : a))}
              />
            </label>
          </div>
          <details>
            <summary>System prompt</summary>
            <textarea
              value={active.systemPrompt}
              onChange={(e) => setActive((a) => (a ? { ...a, systemPrompt: e.target.value } : a))}
              style={{ width: '100%', minHeight: 60 }}
            />
          </details>

          <div className="om-chat__transcript" ref={transcriptRef}>
            {active.messages.length === 0 && !streaming && (
              <p className="om-empty-note">No messages yet — say something below.</p>
            )}
            {active.messages.map((m, i) => (
              <div key={i} className={`om-chat__msg om-chat__msg--${m.role}`}>
                <span className="om-chat__role">{m.role}</span>
                {m.content}
              </div>
            ))}
            {streaming && (
              <div className="om-chat__msg om-chat__msg--assistant">
                <span className="om-chat__role">assistant</span>
                {streamingText || '…'}
              </div>
            )}
          </div>

          <div className="om-actions">
            <button className="cv-item__link" disabled title={attachmentReason}>
              Attach image (disabled — {attachmentReason})
            </button>
            {!capabilities && (
              <button className="cv-item__link" onClick={() => void handleVerifyCapabilities()} disabled={verifyingCaps}>
                {verifyingCaps ? 'Verifying…' : 'Verify model capabilities'}
              </button>
            )}
          </div>

          <div className="om-chat__composer">
            <textarea
              value={composer}
              placeholder="Message…"
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
            />
            {streaming ? (
              <button className="sc-btn" onClick={() => void ollama.chatStop(active.id)}>
                Stop
              </button>
            ) : (
              <button className="sc-btn primary" onClick={() => void handleSend()} disabled={!composer.trim()}>
                Send
              </button>
            )}
          </div>
        </>
      )}
      {deleteConfirm && (
        <ConfirmDialog
          message={`Delete the chat "${active?.title}"? This cannot be undone.`}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}
    </section>
  )
}
