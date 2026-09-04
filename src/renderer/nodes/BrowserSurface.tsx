import { useEffect, useRef, useState } from 'react'
import { normalizeAddress, searchOrUrl } from './browserUrl'
import { BrowserStartPage } from './BrowserStartPage'
import { useBrowserHistory } from '../state/browserHistory'
import { useDiscardWhenHidden, webviewAudible } from './useDiscardWhenHidden'
import { DiscardedPlate } from './DiscardedPlate'
import { BrowserExtensionsPanel } from './BrowserExtensionsPanel'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { validateBrowserPortalUrl, type BrowserPortalLifecycle } from '@shared/browser-portal'
import { IconButton } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'

// Minimal typing for the Electron <webview> element methods/events we use.
type WebviewEl = HTMLElement & {
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  loadURL(url: string): void
  canGoBack(): boolean
  canGoForward(): boolean
  getWebContentsId(): number
  executeJavaScript?(code: string, userGesture?: boolean): Promise<unknown>
  /** Throws before the guest attaches — always go through `webviewAudible`. */
  isCurrentlyAudible?: () => boolean
}

interface BrowserSurfaceProps {
  /** The node id — registers the guest webContents so main can route its new-window requests. */
  nodeId: string
  /** Agent node allowed to expose this browser surface through the Codex Browser Plugin. */
  ownerNodeId?: string
  /** Which mounted surface owns this guest, so lifecycle cleanup never confuses canvas and modal. */
  surface?: 'canvas' | 'modal'
  /** Initial URL (seeded once at mount). */
  url: string
  /**
   * The Electron session partition. Set for an AGENT-opened node
   * (`persist:nt-agent-browser-<projectId>`), absent for a USER-opened node (default session).
   * Applied straight to `<webview partition>`, which is honoured only at attach — the discard/restore
   * remount re-applies the SAME value, so the guest rejoins its jar ([MEASURED, Electron 42.8.1],
   * Probe B). Threaded identically here and in the card modal so the two mounts share one jar
   * (`browser-partition-parity.test.tsx`); a mismatch reads to a user as "my login vanished".
   */
  partition?: string
  /** Persist the top-level URL after a navigation. */
  onUrlChange: (url: string) => void
  /** Persist the page title. */
  onTitleChange: (title: string) => void
  /**
   * The memory saver released this surface's guest process. Optional; today's one caller is a
   * background keep-alive GHOST (see lib/webviewKeepAlive.ts), which answers by dropping its pool
   * entry — a hidden husk with no guest has nothing left to keep alive. An ACTIVE node passes
   * nothing and keeps the plate-and-restore behavior unchanged.
   */
  onGuestDiscarded?: () => void
  /** Portal surfaces accept only absolute HTTP(S) URLs and never fall back to search. */
  strictHttpUrl?: boolean
  /** Ordinary browser nodes support popups; kiosk and portal sessions can disable them. */
  allowPopups?: boolean
  /** Lifecycle signal used by portal chrome and status reporting. */
  onLifecycleChange?: (state: BrowserPortalLifecycle) => void
  /** Optional navigation validator used by kiosk sessions to keep every persisted and live URL HTTP(S). */
  validateUrl?: (url: string) => string | null
  /** Kiosk sessions do not expose extension management in their own toolbar. */
  hideExtensions?: boolean
  /** Fed the guest's web-app manifest (fixed, read-only probe) when a kiosk session wants to adopt it. */
  onManifestDiscovered?: (value: unknown, pageUrl: string) => void
}

/**
 * The navigable Chromium surface (Electron <webview> + back/forward/reload + address bar), with
 * no node chrome. Shared by the canvas {@link BrowserNode} and the kanban card modal, so a browser
 * opens and navigates the same way on both. Navigation is driven by the `src` attribute (a src-less
 * webview never emits dom-ready, so imperative loadURL before then is a no-op); `did-navigate` only
 * updates the address, so in-page navigation can't loop.
 */
export function BrowserSurface({
  nodeId,
  ownerNodeId,
  surface = 'canvas',
  url,
  onUrlChange,
  onTitleChange,
  partition,
  onGuestDiscarded,
  strictHttpUrl = false,
  allowPopups = true,
  onLifecycleChange,
  validateUrl,
  hideExtensions = false,
  onManifestDiscovered
}: BrowserSurfaceProps) {
  const vocab = useVocabularyMapper()
  const ref = useRef<WebviewEl | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const lastUrlRef = useRef('')
  const [startUrl] = useState(() => url ?? '')
  const [src, setSrc] = useState(startUrl)
  const [address, setAddress] = useState(startUrl)
  const [loading, setLoading] = useState(false)
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  const [failed, setFailed] = useState('')
  const [failedExternal, setFailedExternal] = useState(false)
  const failedRef = useRef(false)
  const [showExtensions, setShowExtensions] = useState(false)
  // Memory saver (see `useDiscardWhenHidden`): the page is released while hidden and rebuilt on
  // reveal. `loadingRef` mirrors the `loading` state because the hook reads it at fire time, from
  // a callback that must not force the observer to be re-created.
  const [discarded, setDiscarded] = useState(false)
  const loadingRef = useRef(false)
  /** The URL a restore is replaying (null = no restore in flight); the first did-navigate carrying
   *  exactly it is that echo. Cleared by that navigation, by any user-initiated one, and by a
   *  failed load. */
  const restoringNavRef = useRef<string | null>(null)
  /** The last title we reported (null = the gate is open for the current page's first title). */
  const lastTitleRef = useRef<string | null>(null)
  /** The page a discard would rebuild from — the last location we actually LOADED, never the
   *  address input (which holds whatever the user typed, submitted or not). */
  const locationRef = useRef(startUrl)

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    const onStart = (): void => {
      loadingRef.current = true
      setLoading(true)
      failedRef.current = false
      onLifecycleChange?.('loading')
    }
    const onStop = (): void => {
      loadingRef.current = false
      setLoading(false)
      setCanBack(wv.canGoBack())
      setCanFwd(wv.canGoForward())
      onLifecycleChange?.(failedRef.current ? 'error' : 'ready')
    }
    const onNav = (e: Event): void => {
      const u = (e as unknown as { url: string }).url
      const safeUrl = validateUrl ? validateUrl(u) : u
      if (!safeUrl) {
        restoringNavRef.current = null
        wv.stop()
        setFailed('This session accepts only safe HTTP(S) pages.')
        return
      }
      // A memory-saver restore replays the URL we were already on, and its did-navigate is
      // indistinguishable from a real one. Reporting it would make MERELY LOOKING at a node dirty
      // the project (updateNodeData → dirty + rev bump + SSH mirror write) and bump an unchanged
      // page to the top of Recent. One-shot and value-checked, so a user who navigates for real
      // immediately after a reveal is still recorded.
      // The ref holds the restore's URL rather than a boolean because `locationRef` moves with
      // every navigation INITIATOR: compared against it, a user's own same-URL navigation read as
      // an echo, and after a FAILED restore (no did-navigate ever arrives) the stuck flag swallowed
      // the next address-bar navigation to ANY url — leaving `data.url` stale and filing that
      // page's title under the previous one.
      const echo = restoringNavRef.current !== null && safeUrl === restoringNavRef.current
      restoringNavRef.current = null
      setAddress(safeUrl)
      locationRef.current = safeUrl
      setFailed('')
      failedRef.current = false
      if (echo) return
      // A genuine navigation re-opens the title gate below: the first title of the NEW page always
      // records, however it compares to the old page's.
      lastTitleRef.current = null
      onUrlChange(safeUrl)
      lastUrlRef.current = safeUrl
      useBrowserHistory.getState().record(safeUrl, safeUrl)
    }
    const onWillNavigate = (e: Event): void => {
      if (!strictHttpUrl) return
      const candidate = (e as unknown as { url?: string }).url ?? ''
      if (validateBrowserPortalUrl(candidate)) return
      e.preventDefault()
      setFailed('Navigation was blocked because Browser Portal accepts only HTTP(S) URLs.')
      failedRef.current = true
      onLifecycleChange?.('error')
    }
    const onNavInPage = (e: Event): void => {
      const u = (e as unknown as { url: string }).url
      const safeUrl = validateUrl ? validateUrl(u) : u
      if (!safeUrl) return
      setAddress(safeUrl)
      locationRef.current = safeUrl
    }
    const onTitle = (e: Event): void => {
      const title = (e as unknown as { title: string }).title
      // The restored page re-announces the title it already had, which would re-dirty the project
      // and re-bump history through the other half of the same reveal. Suppressing it by VALUE
      // rather than by a restore flag means a title that genuinely changed still lands.
      if (title === lastTitleRef.current) return
      lastTitleRef.current = title
      onTitleChange(title)
      if (lastUrlRef.current) useBrowserHistory.getState().record(lastUrlRef.current, title)
    }
    const onFail = (e: Event): void => {
      const ev = e as unknown as { isMainFrame: boolean; errorCode: number; errorDescription: string }
      if (ev.isMainFrame && ev.errorCode !== -3) {
        // A restore that never landed has no echo to swallow — disarm, or the next navigation pays.
        restoringNavRef.current = null
        if (ev.errorDescription) {
          setFailed(ev.errorDescription)
          setFailedExternal(true)
        } else {
          setFailed('Failed to load')
          setFailedExternal(false)
        }
      }
    }
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('will-navigate', onWillNavigate)
    wv.addEventListener('did-navigate-in-page', onNavInPage)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('will-navigate', onWillNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavInPage)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('did-fail-load', onFail)
    }
    // `discarded` is a dep because a discard UNMOUNTS the <webview> element (dropping `src` alone
    // would leave the guest process alive): the restored element is a different node, so the
    // listeners have to be re-attached to it.
  }, [onUrlChange, onTitleChange, discarded, validateUrl, onLifecycleChange, strictHttpUrl])

  // Registers the guest so main can route its new-window requests. `discarded` is a dep for the
  // same reason as above — and it is what makes a discard UNREGISTER the dead wcId through this
  // cleanup, rather than leaking it until the node unmounts.
  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    let wcId = 0
    const onReady = (): void => {
      wcId = wv.getWebContentsId()
      window.nodeTerminal.browser.register(wcId, nodeId, ownerNodeId, surface)
      if (onManifestDiscovered && wv.executeJavaScript) {
        // This is a fixed, read-only probe evaluated in the guest. It never receives caller input,
        // never reads cookies, and bounds the manifest before it crosses into the renderer.
        void wv
          .executeJavaScript(
            "(async()=>{const l=document.querySelector('link[rel~=manifest]');if(!l)return null;const u=new URL(l.href,location.href).href;const r=await fetch(u,{credentials:'omit',redirect:'error'});const t=await r.text();if(t.length>262144)throw new Error('manifest-too-large');return {url:u,manifest:JSON.parse(t)}})()",
            false
          )
          .then((result) => {
            if (!result || typeof result !== 'object') return
            const candidate = result as { url?: unknown; manifest?: unknown }
            if (typeof candidate.url === 'string') onManifestDiscovered(candidate.manifest, candidate.url)
          })
          .catch(() => undefined)
      }
    }
    wv.addEventListener('dom-ready', onReady)
    return () => {
      wv.removeEventListener('dom-ready', onReady)
      if (wcId) window.nodeTerminal.browser.unregister(wcId)
    }
  }, [nodeId, ownerNodeId, surface, discarded, onManifestDiscovered])

  // ── Memory saver ────────────────────────────────────────────────────────────────────────────
  // A browser node parked off-screen is a whole Chromium renderer process doing nothing, and the
  // canvas caps nothing. The state machine (observer, timer, fire-time re-checks) lives in the
  // shared hook; this surface contributes only what "loading"/"content" mean for it and how to
  // release and rebuild its page.
  useDiscardWhenHidden(rootRef, {
    isLoading: () => loadingRef.current,
    isAudible: () => webviewAudible(ref.current),
    hasContent: () => !!locationRef.current,
    onDiscard: () => {
      setDiscarded(true)
      setSrc('')
      onLifecycleChange?.('suspended')
      // A failure banner belongs to the page we just released; the restore re-navigates and will
      // raise its own if the load fails again.
      setFailed('')
      onGuestDiscarded?.()
    },
    onRestore: () => {
      setDiscarded(false)
      // Restore from the descriptor. Setting `src` and `address` to the SAME value preserves the
      // `url !== address` guard of the sync effect below, so the restore can't start a reload loop.
      const back = locationRef.current
      // The restore's own did-navigate is an ECHO of this exact URL — see `onNav`.
      restoringNavRef.current = back
      setSrc(back)
      setAddress(back)
      onLifecycleChange?.('loading')
    }
  })

  // Keep the two webviews for one node (canvas + modal) in sync: when `url` changes from the
  // OUTSIDE (the other webview navigated → node.data.url updated) and differs from where we are,
  // follow it. Guarded on `!== address` so our own did-navigate (which sets address = url) is a
  // no-op — no reload loop.
  useEffect(() => {
    if (url && url !== address) {
      // A navigation with an initiator: whatever it navigates to is not a restore echo.
      restoringNavRef.current = null
      setSrc(url)
      setAddress(url)
      // Keep the discard descriptor current even while discarded: a node released off-screen must
      // come back at where the OTHER webview navigated to, not at where it was released.
      locationRef.current = url
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const go = (): void => {
    const safe = searchOrUrl(address)
    const validated = safe ? (validateUrl ? validateUrl(safe) : safe) : null
    if (!validated) {
      setFailed('Enter a URL or search term')
      setFailedExternal(false)
      return
    }
    setAddress(validated)
    setFailed('')
    setFailedExternal(false)
    // A navigation with an initiator: whatever it navigates to is not a restore echo.
    restoringNavRef.current = null
    locationRef.current = validated
    if (validated === src) ref.current?.reload()
    else setSrc(validated)
  }

  return (
    <div className="browser-surface" ref={rootRef}>
      <div className="browser-node__toolbar nodrag">
        <IconButton size="compact" className="browser-node__btn" vocabularyMode="factual" disabled={!canBack} onClick={() => ref.current?.goBack()} title={vocab('Back')} aria-label={vocab('Back')}>
          ◀
        </IconButton>
        <IconButton size="compact" className="browser-node__btn" vocabularyMode="factual" disabled={!canFwd} onClick={() => ref.current?.goForward()} title={vocab('Forward')} aria-label={vocab('Forward')}>
          ▶
        </IconButton>
        <IconButton
          size="compact"
          className="browser-node__btn"
          icon={loading ? 'close' : 'refresh'}
          vocabularyMode="factual"
          onClick={() => (loading ? ref.current?.stop() : ref.current?.reload())}
          title={vocab(loading ? 'Stop' : 'Reload')}
          aria-label={vocab(loading ? 'Stop' : 'Reload')}
        />
        <Input
          className="browser-node__address"
          vocabularyMode="factual"
          value={address}
          spellCheck={false}
          placeholder={vocab('Enter a URL and press Enter')}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go()
          }}
        />
        {!hideExtensions && (
        <div className="browser-ext-panel__anchor">
          <IconButton
            size="compact"
            className="browser-node__btn"
            vocabularyMode="factual"
            active={showExtensions}
            onClick={() => setShowExtensions((v) => !v)}
            title={vocab('Extensions')}
            aria-label={vocab('Extensions')}
            aria-expanded={showExtensions}
          >
            ⬒
          </IconButton>
          {showExtensions && (
            <BrowserExtensionsPanel partition={partition} onClose={() => setShowExtensions(false)} />
          )}
        </div>
        )}
      </div>
      <div className="browser-node__view nodrag nowheel">
        {/* The element is UNMOUNTED while discarded — that is what ends the guest process; an
            emptied `src` attribute does not (Electron ignores a src mutation to nothing). */}
        {!discarded && (
          // eslint-disable-next-line react/no-unknown-property
          <webview
            ref={ref as unknown as React.Ref<HTMLElement>}
            src={src || undefined}
            partition={partition || undefined}
            allowpopups={allowPopups}
            style={{ width: '100%', height: '100%' }}
          />
        )}
        {!src && !discarded && !strictHttpUrl && (
          <BrowserStartPage
            onNavigate={(u) => {
              // A navigation with an initiator: whatever it navigates to is not a restore echo.
              restoringNavRef.current = null
              setSrc(u)
              setAddress(u)
              locationRef.current = u
              setFailed('')
            }}
          />
        )}
        {discarded && <DiscardedPlate />}
        {failed && <div className="browser-node__error">{failedExternal ? failed : vocab(failed)}</div>}
      </div>
    </div>
  )
}
