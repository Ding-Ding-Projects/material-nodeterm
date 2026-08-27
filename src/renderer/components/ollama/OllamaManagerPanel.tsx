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
  type PullItemStatus,
  type PullQueueItem,
  type PullQueueState
} from '@shared/ollama'
import { E_UNSUPPORTED } from '@shared/rpc'
import { formatBytes } from '../../lib/bytesFormat'
import { useActiveSessionApi } from '../../session/session'
import { ConfirmDialog } from '../ConfirmDialog'
import { MaterialSymbol, type MaterialSymbolName } from '../MaterialSymbol'
import { promptDialog } from '../promptDialog'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { copy, fact, mapOwnedSentence, type DisplaySegment } from '../../lib/personalVocabulary/ownedCopy'
import {
  catalogPollDelayMs,
  catalogPollShouldContinue,
  formatAge,
  parseCatalogPayload,
  selectCatalogPage,
  type CatalogFilter,
  type CatalogPage,
  type CatalogRow,
  type CatalogSort,
  type CatalogView
} from './catalogView'
import { troubleshootSteps } from './troubleshoot'
import { Progress, Tabs, TextArea } from '@renderer/ui/md3'
import { Select } from '@renderer/ui/Select'

/** How often the panel re-asks for the catalog while the core reports a refresh in flight. The
 *  catalog rides an argument-less request/response channel (see core/ollama/register-ipc.ts), so
 *  there is no push event to subscribe to; polling stops as soon as the refresh goes idle. */
const CATALOG_POLL_MS = 3000
const STORE_PAGE_SIZE = 50

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
  copy: string
  detail?: string
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
      copy:
        'Ollama is not available for this remote project session. The manager will not fall back to this computer.'
    }
  }
  const detail = error instanceof Error ? error.message : String(error)
  return { code, copy: 'Could not load Ollama for this project session:', detail }
}

const toast = (message: string, kind: 'error' | 'info' = 'info'): void => {
  window.dispatchEvent(new CustomEvent('nodeterm:toast', { detail: { kind, message } }))
}

const PULL_STATUS_ICON: Record<PullItemStatus, MaterialSymbolName> = {
  queued: 'schedule',
  running: 'sync',
  paused: 'hourglass_top',
  done: 'check_circle',
  failed: 'warning',
  cancelled: 'close'
}

function pullStatusIcon(status: PullItemStatus): MaterialSymbolName {
  return PULL_STATUS_ICON[status]
}

const FIT_ICON: Record<FitEvaluation['verdict'], MaterialSymbolName> = {
  'runs-well': 'check_circle',
  'runs-with-limits': 'warning',
  unlikely: 'block',
  unknown: 'radio_button_unchecked'
}

function FitBadge({ fit }: { fit: FitEvaluation | undefined }) {
  const vocab = useVocabularyMapper()
  if (!fit)
    return (
      <span className="om-fit om-fit--unknown">
        <MaterialSymbol name="radio_button_unchecked" size={14} />
        {vocab('Unknown')}
      </span>
    )
  const label =
    fit.verdict === 'runs-well'
      ? 'Runs well'
      : fit.verdict === 'runs-with-limits'
        ? 'Runs with limits'
        : fit.verdict === 'unlikely'
          ? 'Unlikely'
          : 'Unknown'
  return (
    <span className={`om-fit om-fit--${fit.verdict}`}>
      <MaterialSymbol name={FIT_ICON[fit.verdict]} size={14} />
      {vocab(label)}
    </span>
  )
}

function FitDetail({ fit }: { fit: FitEvaluation | undefined }) {
  const vocab = useVocabularyMapper()
  if (!fit) return null
  return (
    <div className="om-fit-detail">
      <ul>
        {fit.evidence.map((e, i) => (
          <li key={i}>{vocab('Evidence:')} {e}</li>
        ))}
        {fit.assumptions.map((a, i) => (
          <li key={`a-${i}`}>{vocab('Assumption:')} {a}</li>
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
 * The Model store lists the exhaustive catalog of Ollama's own first-party library — every model
 * and every tag on ollama.com/library, paginated, searchable, filterable and sortable, each row
 * carrying whatever revision/size/date its source really has, above a recorded completeness and
 * staleness state. Community models (published under a namespace, e.g. "user/model") have no
 * enumerable index — ollama.com/search caps results at ~20 per query with no working pagination,
 * measured live — so they are reached by exact reference, not by browsing this list; the
 * completeness headline names this scope explicitly rather than ever claiming "every model". What
 * the catalog can and cannot know (and why it needs a first-party network source at all) is
 * core/ollama/catalog-*.ts and docs/ollama-manager.md.
 *
 * Known gaps versus the full house contract, left for a follow-up (see docs/ollama-manager.md):
 * image attachments are gated correctly but not actually implemented (the control stays visibly
 * disabled with the real reason); and the search boxes are plain substring search, not the full
 * anchored regex builder.
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
  const vocab = useVocabularyMapper()
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
  const [catalog, setCatalog] = useState<CatalogView | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [fitMap, setFitMap] = useState<Record<string, FitEvaluation>>({})
  const [storeQuery, setStoreQuery] = useState('')
  const [storeFilter, setStoreFilter] = useState<CatalogFilter>('all')
  const [storeSort, setStoreSort] = useState<CatalogSort>('name')
  const [storePage, setStorePage] = useState(1)
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

  /** Loads the model catalog for the ACTIVE session. The channel's declared return type is still
   *  the legacy `{name, note}[]` short list (its declaration lives in a file this pass does not
   *  own), while the core now answers with a catalog snapshot — so the payload is parsed as
   *  untrusted input, and the legacy array is still understood. A failure sets an error and leaves
   *  whatever was already listed alone: "could not load" must not render as "there are none".
   *
   *  Returns the freshly parsed view (or `null` on failure/staleness) rather than only updating
   *  state: the progress-poll loop below needs to know THIS attempt's outcome synchronously to
   *  decide whether to keep polling, and reading it back off `catalog` state would race React's
   *  render cycle (a `setCatalog` call does not make the new value visible until the next render). */
  const loadCatalog = useCallback(async (): Promise<CatalogView | null> => {
    try {
      const payload = (await ollama.popularModels()) as unknown
      if (!apiStillActive(api)) return null
      const view = parseCatalogPayload(payload)
      setCatalog(view)
      setCatalogError(null)
      return view
    } catch (e) {
      if (!apiStillActive(api)) return null
      setCatalogError((e as Error).message)
      return null
    }
  }, [api, apiStillActive, ollama])

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
    setCatalog(null)
    setCatalogError(null)
    setStorePage(1)
    setFitMap({})
    setCart([])
    setCartSummary({ running: false, concurrency: 1 })
    // A confirmation is authority for exactly the api/model pair that opened it. On a project
    // switch, retaining it would let its model name cross into the next machine's delete call.
    setDeleteTarget(null)
    setAccessError(null)
    void refreshStatus()
    void loadCatalog()
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
  }, [loadCatalog, ollama, refreshStatus])

  // While the core reports a crawl in flight, re-ask periodically so the completeness counters move
  // instead of freezing at whatever the first call happened to catch. This is a SELF-PERPETUATING
  // loop (each attempt schedules the next one itself via `catalogPollShouldContinue`/
  // `catalogPollDelayMs`, both pure and tested in catalogView.ts) rather than one keyed on `catalog`
  // object identity: a version keyed that way only re-arms on a SUCCESSFUL load replacing `catalog`,
  // so a single transient rejection (`catalogError` set, `catalog` untouched) left the loop
  // permanently dead — the panel stuck on a stale "Still fetching…" counter until a manual Reload.
  // The effect itself is keyed on the primitive `catalog?.refreshing` boolean, not the `catalog`
  // object: every poll (success or failure) replaces or leaves `catalog`, but the loop must not
  // restart on each one — only start when a refresh begins and stop when one goes idle or unmounts.
  useEffect(() => {
    if (!catalog?.refreshing) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    const tick = async (): Promise<void> => {
      const view = await loadCatalog()
      if (cancelled) return
      failures = view === null ? failures + 1 : 0
      if (catalogPollShouldContinue(view)) {
        timer = setTimeout(() => void tick(), catalogPollDelayMs(failures, CATALOG_POLL_MS))
      }
    }
    timer = setTimeout(() => void tick(), CATALOG_POLL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [catalog?.refreshing, loadCatalog])

  // A query/filter/sort change can shorten the list past the current page. Land on page 1 rather
  // than on an empty page, which reads as "no results" when there are thousands.
  useEffect(() => {
    setStorePage(1)
  }, [storeQuery, storeFilter, storeSort])

  const catalogPage = useMemo(
    () =>
      selectCatalogPage(catalog?.rows ?? [], {
        query: storeQuery,
        filter: storeFilter,
        sort: storeSort,
        page: storePage,
        pageSize: STORE_PAGE_SIZE
      }),
    [catalog, storeQuery, storeFilter, storeSort, storePage]
  )

  // Recompute fit for installed models, the cart, and the catalog rows actually ON SCREEN. The
  // catalog is thousands of rows now; asking for a verdict on all of them would be a pointless
  // round trip per page turn, and the verdicts the user can see are the ones that matter.
  //
  // The set of visible refs, not `catalogPage` itself, is what this effect actually consumes — but
  // `catalogPage` is a fresh object every time the 3 s catalog poll lands (`selectCatalogPage`
  // re-runs because its `catalog` input is a new object each successful load, even when the visible
  // page's refs did not change at all). Keying the effect on `catalogPage`'s IDENTITY therefore
  // re-fires on every poll tick during a first-time crawl that can run for minutes — each firing
  // spawns `nvidia-smi` (2.5 s timeout) plus a disk probe plus a full `/api/tags` read. `fitRefsKey`
  // is a primitive string built from the same refs; two computations that land on the same set of
  // refs produce the same string VALUE, and React's dependency comparison (`Object.is`) treats equal
  // primitives as unchanged regardless of how many times the surrounding objects were rebuilt.
  const fitRefsKey = useMemo(() => {
    const refs = new Set<string>()
    for (const m of models) refs.add(m.name)
    for (const row of catalogPage.rows) refs.add(row.ref)
    for (const c of cart) refs.add(c.ref)
    return [...refs].sort().join('\n')
  }, [models, catalogPage, cart])

  useEffect(() => {
    if (status?.health !== 'ok') return
    if (fitRefsKey === '') return
    const refs = fitRefsKey.split('\n')
    ollama
      .fit(refs)
      .then((fit) => {
        if (apiStillActive(api)) setFitMap(fit)
      })
      .catch(() => {})
  }, [fitRefsKey, status?.health, api, apiStillActive, ollama])

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
    <div className="drawer-overlay md3-ollama" onClick={onClose}>
      <aside className="drawer ollama" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={vocab('Ollama manager')}>
        <div className="drawer__head">
          <h2>{vocab('Ollama manager')}</h2>
          <button className="drawer__close" onClick={onClose} aria-label={vocab('Close')}>
            <MaterialSymbol name="close" size={18} />
          </button>
        </div>
        <div className="drawer__body om-body">
          {accessError ? (
            <section className="om-empty-note" role="alert">
              <p>{vocab(accessError.copy)}{accessError.detail && <> {accessError.detail}</>}</p>
              {accessError.code && (
                <p>
                  Refusal code: <code>{accessError.code}</code>
                </p>
              )}
              {accessError.code !== E_UNSUPPORTED && (
                <button className="sc-btn" onClick={() => void refreshStatus()} disabled={checking}>
                  {vocab('Retry')}
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
                    {vocab(t === 'health' ? 'Health' : t === 'models' ? 'Installed' : t === 'store' ? 'Model store' : 'Chat')}
                  </button>
                ))}
              </div>
              <Tabs
                items={[
                  { id: 'health', label: 'Health' },
                  { id: 'models', label: 'Installed' },
                  { id: 'store', label: 'Model store' },
                  { id: 'chat', label: 'Chat' }
                ]}
                value={tab}
                onChange={(id) => setTab(id as Tab)}
                ariaLabel="Ollama sections"
                className="om-tabs"
                tabClassName="om-tab"
                activeTabClassName="om-tab--active"
                idPrefix="ollama-tab"
                panelIdPrefix="ollama-tabpanel"
              />

              {tab === 'health' && (
                <div
                  role="tabpanel"
                  id="ollama-tabpanel-health"
                  aria-labelledby="ollama-tab-health"
                  className="om-tabpanel"
                >
                  <HealthTab
                    status={status}
                    checking={checking}
                    hardware={hardware}
                    running={running}
                    onRefresh={refreshStatus}
                  />
                </div>
              )}

              {tab === 'models' && (
                <div
                  role="tabpanel"
                  id="ollama-tabpanel-models"
                  aria-labelledby="ollama-tab-models"
                  className="om-tabpanel"
                >
                  <ModelsTab
                    status={status}
                    models={models}
                    fitMap={fitMap}
                    onDelete={(model) => setDeleteTarget({ model, api })}
                    onRefresh={refreshStatus}
                  />
                </div>
              )}

              {tab === 'store' && (
                <div
                  role="tabpanel"
                  id="ollama-tabpanel-store"
                  aria-labelledby="ollama-tab-store"
                  className="om-tabpanel"
                >
                  <StoreTab
                    ollama={ollama}
                    status={status}
                    storeQuery={storeQuery}
                    setStoreQuery={setStoreQuery}
                    storeFilter={storeFilter}
                    setStoreFilter={setStoreFilter}
                    storeSort={storeSort}
                    setStoreSort={setStoreSort}
                    page={catalogPage}
                    setStorePage={setStorePage}
                    catalog={catalog}
                    catalogError={catalogError}
                    onReloadCatalog={loadCatalog}
                    fitMap={fitMap}
                    customRef={customRef}
                    setCustomRef={setCustomRef}
                    onAddCustomRef={handleAddCustomRef}
                    onAddToCart={handleAddToCart}
                    cart={cart}
                    cartSummary={cartSummary}
                    cartEstimate={cartEstimate}
                  />
                </div>
              )}

              {tab === 'chat' && (
                <div
                  role="tabpanel"
                  id="ollama-tabpanel-chat"
                  aria-labelledby="ollama-tab-chat"
                  className="om-tabpanel"
                >
                  <ChatTab key={chatScopeKey(ollama)} ollama={ollama} status={status} models={models} />
                </div>
              )}
            </>
          )}
        </div>
      </aside>
      {deleteTarget?.api === api && (
        <ConfirmDialog
          message=""
          messageSegments={[
            copy('Delete the installed model "'),
            fact(deleteTarget.model),
            copy('"? This removes its blobs from disk.')
          ]}
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
  const vocab = useVocabularyMapper()
  const ok = status?.health === 'ok'
  const dotClass = checking ? 'checking' : ok ? 'ok' : status ? 'bad' : ''
  return (
    <section>
      <div className="om-health">
        <span className={`om-health__dot om-health__dot--${dotClass}`} aria-hidden />
        <span>
          {checking
            ? vocab('Checking…')
            : !status
              ? vocab('Not checked yet')
              : status.health === 'ok'
                    ? <>{vocab('Running')} — Ollama {status.version ?? vocab('unknown version')} {vocab('at')} {status.endpoint}</>
                : status.health === 'not-installed'
                  ? vocab('Ollama does not appear to be installed')
                  : status.health === 'stopped'
                    ? <>{vocab('Ollama is not running at')} {status.endpoint} ({vocab('connection refused')})</>
                    : status.health === 'unreachable'
                      ? <>{vocab('Could not reach Ollama at')} {status.endpoint}</>
                      : <>{vocab('Ollama answered but reported a problem:')} {status.detail ?? vocab('unknown error')}</>}
        </span>
        <button className="sc-btn" onClick={onRefresh} disabled={checking}>
          {vocab('Retry')}
        </button>
      </div>

      {hardware && (
        <p className="om-hardware">
          {formatBytes(hardware.totalRamBytes)} {vocab('RAM total')} ({formatBytes(hardware.freeRamBytes)} {vocab('free')}) ·{' '}
          {hardware.gpuName ? <>{vocab('GPU:')} {hardware.gpuName}</> : vocab('No GPU detected')}
          {hardware.vramBytes !== null && ` (${formatBytes(hardware.vramBytes)} VRAM)`} · {vocab('Free disk:')}{' '}
          {formatBytes(hardware.freeDiskBytes)} · {hardware.platform}/{hardware.arch}
        </p>
      )}

      {!ok && (
        <div className="om-troubleshoot">
          <p>
          <strong>{vocab('Get Ollama running:')}</strong>
          </p>
          <ol>
            {troubleshootSteps(hardware?.platform ?? 'linux', status?.health).map((step, i) => (
              <li key={i}>
                {vocab(step.label)}
                {step.command && <pre>{step.command}</pre>}
              </li>
            ))}
          </ol>
          <button className="sc-btn" onClick={onRefresh}>
            {vocab("I've done this — check again")}
          </button>
        </div>
      )}

      {ok && running.length > 0 && (
        <>
          <h3>{vocab('Currently loaded')}</h3>
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
  const vocab = useVocabularyMapper()
  const [expanded, setExpanded] = useState<string | null>(null)
  if (status?.health !== 'ok') {
    return <p className="om-empty-note">{vocab('Ollama is not reachable — see the Health tab.')}</p>
  }
  return (
    <section>
      <div className="om-actions">
        <button className="sc-btn" onClick={onRefresh}>
          {vocab('Refresh')}
        </button>
      </div>
      {models.length === 0 ? (
        <p className="om-empty-note">{vocab('No models installed yet — pull one from the Model store tab.')}</p>
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
                  {vocab('Delete')}
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

/** One catalog row's size, stated at the precision the source actually has. "≈" is not decoration:
 *  the library page prints "1.3GB" while the manifest knows 1_321_098_329 bytes, and a rounded
 *  figure must not look like a measured one. A missing size stays "unknown", never 0. */
function CatalogSize({ row }: { row: CatalogRow }) {
  const vocab = useVocabularyMapper()
  if (row.sizeBytes === null) {
    return (
      <span className="om-model__meta" title={row.factsError ?? undefined}>
        {vocab(row.factsError ? 'size unavailable' : 'size not fetched yet')}
      </span>
    )
  }
  return (
    <span className="om-model__meta">
      {row.sizeExact ? '' : '≈'}
      {formatBytes(row.sizeBytes)}
    </span>
  )
}

function catalogHeadlineText(
  vocab: (text: string) => string,
  view: CatalogView
): string {
  switch (view.completeness.state) {
    case 'complete':
      return mapOwnedSentence(vocab, [
        copy('Complete first-party library: all '),
        fact(String(view.completeness.modelsKnown)),
        copy(' models and all '),
        fact(String(view.completeness.tagsKnown)),
        copy(' tags on ollama.com/library. Community models aren\'t enumerable — add one by exact reference.')
      ])
    case 'partial':
      return mapOwnedSentence(vocab, [
        copy('Partial catalog: '),
        fact(String(view.completeness.tagsKnown)),
        copy(' tags across '),
        fact(String(view.completeness.modelsKnown)),
        copy(' models fetched so far — this is not yet the whole catalog.')
      ])
    case 'unavailable':
      return vocab('The published catalog could not be loaded. This is a load failure, not an empty catalog — the exact-reference field below still reaches any model.')
    default:
      return view.source === 'legacy'
        ? vocab('Short model list from this session — completeness unknown.')
        : vocab('Catalog state is unknown for this session.')
  }
}

export function catalogStalenessSegments(
  view: CatalogView,
  now: number
): readonly DisplaySegment[] | null {
  switch (view.staleness) {
    case 'never':
      return view.registryEnabled ? [copy('The catalog has never been fetched on this machine.')] : null
    case 'stale':
      return view.indexFetchedAt === null
        ? [copy('The cached catalog is out of date and is being refreshed.')]
        : [
            copy('The cached catalog is out of date (last fetched '),
            fact(formatAge(now - view.indexFetchedAt)),
            copy(' ago) and is being refreshed.')
          ]
    case 'fresh':
      return view.indexFetchedAt === null
        ? null
        : [copy('Catalog fetched '), fact(formatAge(now - view.indexFetchedAt)), copy(' ago.')]
    default:
      return null
  }
}

export function ollamaPageSummarySegments(page: CatalogPage) {
  return [
    copy('Showing '), fact(String(page.from)), copy('–'), fact(String(page.to)), copy(' of '),
    fact(String(page.total)), copy(' matching references (page '), fact(String(page.page)), copy(' of '),
    fact(String(page.pageCount)), copy(').')
  ]
}

function StoreTab({
  ollama,
  status,
  storeQuery,
  setStoreQuery,
  storeFilter,
  setStoreFilter,
  storeSort,
  setStoreSort,
  page,
  setStorePage,
  catalog,
  catalogError,
  onReloadCatalog,
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
  storeFilter: CatalogFilter
  setStoreFilter: (v: CatalogFilter) => void
  storeSort: CatalogSort
  setStoreSort: (v: CatalogSort) => void
  page: CatalogPage
  setStorePage: (updater: (current: number) => number) => void
  catalog: CatalogView | null
  catalogError: string | null
  onReloadCatalog: () => void
  fitMap: Record<string, FitEvaluation>
  customRef: string
  setCustomRef: (v: string) => void
  onAddCustomRef: () => void
  onAddToCart: (ref: string) => void
  cart: PullQueueItem[]
  cartSummary: Pick<PullQueueState, 'running' | 'concurrency'>
  cartEstimate: { known: number; unknownCount: number }
}) {
  const vocab = useVocabularyMapper()
  return (
    <>
      <section>
        <h3>{vocab('Model catalog')}</h3>
        {catalog === null ? (
          <p className="om-empty-note">
            {catalogError
              ? <>{vocab('The catalog could not be loaded:')} {catalogError}. {vocab('This is a load failure, not an empty catalog — the exact-reference field below still reaches any model.')}</>
              : vocab('Loading the catalog…')}
          </p>
        ) : (
          <div
            // Reuses the panel's existing note styling so this block is legible today; the
            // completeness modifier is there for a later stylesheet pass (the Ollama styles live
            // outside this change's ownership) and is inert until then.
            className={`om-empty-note om-catalog-state om-catalog-state--${catalog.completeness.state}`}
            role="status"
            aria-live="polite"
          >
              <p>{catalogHeadlineText(vocab, catalog)}</p>
            {catalog.refreshing && (
              <p>
              {mapOwnedSentence(vocab, [copy('Still fetching: '), fact(String(catalog.pendingTagFetches)), copy(' model tag lists, '), fact(String(catalog.pendingFactFetches)), copy(' exact sizes.')])}
              </p>
            )}
            {(() => {
              const staleness = catalogStalenessSegments(catalog, Date.now())
              return staleness ? <p>{mapOwnedSentence(vocab, staleness)}</p> : null
            })()}
            {catalog.completeness.reasons.map((reason, i) => (
              <p key={i}>{mapOwnedSentence(vocab, [fact(reason)])}</p>
            ))}
            {catalog.refreshError && <p>{vocab('Last refresh error:')} {catalog.refreshError}</p>}
            {catalogError && <p>{vocab('The most recent reload failed:')} {catalogError}. {vocab('Showing the last list that loaded.')}</p>}
            <button className="sc-btn" onClick={onReloadCatalog}>
              {vocab('Reload catalog')}
            </button>
          </div>
        )}
        <div className="om-actions">
          <input
            type="search"
            className="om-search"
            style={{ marginBottom: 0, flex: 1 }}
            placeholder={vocab('Search every model and tag…')}
            aria-label={vocab('Search the model catalog')}
            value={storeQuery}
            onChange={(e) => setStoreQuery(e.target.value)}
          />
          <label>
            {vocab('Show')}
            <Select
              aria-label={vocab('Filter the model catalog')}
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value as CatalogFilter)}
            >
              <option value="all">{vocab('Everything')}</option>
              <option value="installed">{vocab('Installed')}</option>
              <option value="not-installed">{vocab('Not installed')}</option>
              <option value="with-size">{vocab('Known size')}</option>
            </Select>
          </label>
          <label>
            {vocab('Sort')}
            <Select
              aria-label={vocab('Sort the model catalog')}
              value={storeSort}
              onChange={(e) => setStoreSort(e.target.value as CatalogSort)}
            >
              <option value="name">{vocab('Name')}</option>
              <option value="size-asc">{vocab('Smallest first')}</option>
              <option value="size-desc">{vocab('Largest first')}</option>
              <option value="installed-first">{vocab('Installed first')}</option>
            </Select>
          </label>
        </div>
        <p className="om-empty-note">
          {page.total === 0
            ? catalog && catalog.rows.length > 0
              ? vocab('No catalog row matches this search or filter.')
              : vocab('No rows are listed. See the catalog state above for whether that is a load failure or a catalog that is genuinely still being fetched.')
            : mapOwnedSentence(vocab, ollamaPageSummarySegments(page))}
        </p>
        <ul className="om-model-list">
          {page.rows.map((row) => (
            <li key={row.ref} className="om-model">
              <div className="om-model__row">
                <span className="om-model__name">{row.ref}</span>
                {row.installed && <span className="om-model__meta">{vocab('installed')}</span>}
                <CatalogSize row={row} />
                <span className="om-model__meta" title={row.revision ?? undefined}>
                  {row.revision
                    ? // `revisionExact` = the FULL 64-hex manifest digest, sliced to 12 chars for
                      // display — that slice IS a truncation and must carry the "…". A short
                      // digest (`revisionExact` false) is the library page's own 12-hex figure,
                      // shown here complete: appending "…" to it would claim more digits exist
                      // than were ever fetched. (This used to be backwards — the truncated case
                      // had no ellipsis and the complete case had one.)
                      <>{vocab('rev')} {row.revision.replace(/^sha256:/, '').slice(0, 12)}{row.revisionExact ? '…' : ''}</>
                    : <>{vocab('rev')} {vocab('unknown')}</>}
                </span>
                <span className="om-model__meta">
                  {row.installed
                    ? // `publishedAt` is never a real publish date — catalog-types.ts documents it
                      // as ONLY ever an installed model's local /api/tags `modified_at` (neither the
                      // registry manifest nor the library pages expose a machine-readable publish
                      // time). Labeling it "installed" says what it actually is; showing a bare date
                      // here implied a publish date this app has never had evidence for.
                      row.publishedAt
                      ? <>{vocab('installed')} {new Date(row.publishedAt).toLocaleDateString()}</>
                      : vocab('no timestamp')
                    : vocab('no published date')}
                </span>
                <FitBadge fit={fitMap[row.ref]} />
                <button className="sc-btn" disabled={status?.health !== 'ok'} onClick={() => onAddToCart(row.ref)}>
                  {vocab('Add to cart')}
                </button>
              </div>
              {row.tag === null && (
                <p className="om-empty-note">
                  {row.tagsState === 'error'
                    ? mapOwnedSentence(vocab, [copy("This model's tag list could not be fetched ("), fact(row.tagsError ?? 'unknown error'), copy(") — its other tags are not listed. The bare name pulls "), fact(':latest'), copy('.')])
                    : mapOwnedSentence(vocab, [copy("This model's published tag list has not been fetched yet — its other tags are not listed. The bare name pulls "), fact(':latest'), copy('.')])}
                </p>
              )}
            </li>
          ))}
        </ul>
        {page.pageCount > 1 && (
          <div className="om-actions">
            <button className="sc-btn" disabled={page.page <= 1} onClick={() => setStorePage((p) => p - 1)}>
              {vocab('Previous')}
            </button>
            <span className="om-model__meta">
              {vocab('Page')} {page.page} {vocab('of')} {page.pageCount}
            </span>
            <button
              className="sc-btn"
              disabled={page.page >= page.pageCount}
              onClick={() => setStorePage((p) => p + 1)}
            >
              {vocab('Next')}
            </button>
          </div>
        )}
        <div className="om-actions" style={{ marginTop: 10 }}>
          <input
            type="text"
            className="om-search"
            style={{ marginBottom: 0, flex: 1 }}
            placeholder={vocab('Exact model reference, e.g. llama3.2:1b')}
            aria-label={vocab('Model reference')}
            value={customRef}
            onChange={(e) => setCustomRef(e.target.value)}
          />
          <button className="sc-btn" disabled={status?.health !== 'ok' || !customRef.trim()} onClick={onAddCustomRef}>
            {vocab('Add')}
          </button>
        </div>
      </section>

      <section>
        <h3>{vocab('Pull queue (cart)')}</h3>
        <p className="om-empty-note">
          {vocab('Downloads only — there is no price, account, or purchase here. Estimated total for pending items with a known size:')} {formatBytes(cartEstimate.known)}
          {cartEstimate.unknownCount > 0 && ` (+${cartEstimate.unknownCount} ${vocab('of unknown size')})`}.
        </p>
        <div className="cv-queue-controls">
          <button
            className="sc-btn"
            disabled={cart.length === 0}
            onClick={() =>
              void (cartSummary.running ? ollama.pullPause() : ollama.pullStart())
            }
          >
            {vocab(cartSummary.running ? 'Pause' : 'Start')}
          </button>
          <label className="cv-concurrency">
            {vocab('Parallel:')}
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
          <p className="om-empty-note">{vocab('The cart is empty.')}</p>
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
                      <MaterialSymbol name={pullStatusIcon(item.status)} size={16} />
                    </span>
                    <span className="cv-item__name">{item.ref}</span>
                    <span className="cv-item__size">
                      {item.completedBytes !== null ? formatBytes(item.completedBytes) : '—'}
                      {item.totalBytes !== null && ` / ${formatBytes(item.totalBytes)}`}
                    </span>
                    <span className="cv-item__status">{item.digestPhase ?? vocab(item.status)}</span>
                  </div>
                  {pct !== null && (
                    <Progress
                      value={pct}
                      label={`Download progress for ${item.ref}`}
                      className="cv-progress"
                      barClassName="cv-progress__bar"
                    />
                  )}
                  {item.error && <p className="cv-item__error">{item.error}</p>}
                  <div className="cv-item__actions">
                    {(item.status === 'queued' || item.status === 'running') && (
                      <button className="cv-item__link" onClick={() => void ollama.pullCancelItem(item.id)}>
                        {vocab('Cancel')}
                      </button>
                    )}
                    {(item.status === 'failed' || item.status === 'cancelled') && (
                      <button className="cv-item__link" onClick={() => void ollama.pullRetryItem(item.id)}>
                        {vocab('Retry')}
                      </button>
                    )}
                    {item.status !== 'running' && item.status !== 'queued' && (
                      <button className="cv-item__link" onClick={() => void ollama.pullRemoveItem(item.id)}>
                        {vocab('Remove')}
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
  const vocab = useVocabularyMapper()
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

  if (status?.health !== 'ok') return <p className="om-empty-note">{vocab('Ollama is not reachable — see the Health tab.')}</p>

  const hasVision = capabilities?.includes('vision') ?? false
  const attachmentReason = !active
    ? vocab('Start a chat first')
    : capabilities === null
      ? vocab("This model's capabilities have not been verified yet")
      : !hasVision
        ? mapOwnedSentence(vocab, [copy('"'), fact(active.model), copy('" has no verified vision capability')])
        : vocab('Image attachments are not implemented in this build yet')

  return (
    <section className="om-chat">
      <div className="om-actions">
        <button className="sc-btn" onClick={() => void handleNewChat()}>
          {vocab('New chat')}
        </button>
        {active && (
          <>
            <button className="sc-btn" onClick={() => void handleRename()}>
              {vocab('Rename')}
            </button>
            <button className="sc-btn" onClick={() => void handleExport()}>
              {vocab('Export (Markdown)')}
            </button>
            <button className="cv-item__link" onClick={() => setDeleteConfirm(true)}>
              {vocab('Delete')}
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
        <p className="om-empty-note">{vocab('No chat open. Start a new one.')}</p>
      ) : (
        <>
          <div className="om-actions">
            <label>
              {vocab('Model:')}{' '}
              <Select
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
              </Select>
            </label>
          </div>
          <div className="om-chat__params">
            <label>
              {vocab('Temperature:')}{' '}
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
              {vocab('Top-p:')}{' '}
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
              {vocab('Context:')}{' '}
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
            <summary>{vocab('System prompt')}</summary>
            <TextArea
              value={active.systemPrompt}
              onChange={(e) => setActive((a) => (a ? { ...a, systemPrompt: e.target.value } : a))}
              style={{ width: '100%', minHeight: 60 }}
            />
          </details>

          <div className="om-chat__transcript" ref={transcriptRef}>
            {active.messages.length === 0 && !streaming && (
              <p className="om-empty-note">{vocab('No messages yet — say something below.')}</p>
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
              {vocab('Attach image')} ({vocab('disabled')} — {attachmentReason})
            </button>
            {!capabilities && (
              <button className="cv-item__link" onClick={() => void handleVerifyCapabilities()} disabled={verifyingCaps}>
                {vocab(verifyingCaps ? 'Verifying…' : 'Verify model capabilities')}
              </button>
            )}
          </div>

          <div className="om-chat__composer">
            <TextArea
              value={composer}
              placeholder={vocab('Message…')}
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
                {vocab('Stop')}
              </button>
            ) : (
              <button className="sc-btn primary" onClick={() => void handleSend()} disabled={!composer.trim()}>
                {vocab('Send')}
              </button>
            )}
          </div>
        </>
      )}
      {deleteConfirm && (
        <ConfirmDialog
          message=""
          messageSegments={[
            copy('Delete the chat "'),
            fact(active?.title ?? ''),
            copy('"? This cannot be undone.')
          ]}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}
    </section>
  )
}
