// "Escape to widget" — the trimmed-down renderer mounted in a widget window's own webContents
// (`main/canvas-widget-window.ts` loads THIS bundle with `?widget=<nodeId>`; see `main.tsx`'s
// bootstrap for the branch that mounts this instead of the full `<App/>`).
//
// It co-attaches to the SAME tmux/session-host session the canvas node owns — a second live
// subscriber, exactly the mechanism `ModalTerminal.tsx` uses for the kanban card modal (see that
// file's module doc for "viewer identity"). The one difference: `ModalTerminal` needs an explicit
// `viewerId` because it shares a webContents with the canvas node's own PRIMARY view; this window
// has its OWN webContents (its own `ClientId`), so a bare `LocalTransport()` is already a distinct
// subscriber with no viewerId needed.
//
// Deliberately minimal vs. both TerminalNode and ModalTerminal: no ssh/agent-launch/permission-mode
// (the session this joins already exists — those parameters only matter at FIRST create), no
// search, no dictation, no file-drop, no park/WebGL budget. This window's whole job is "show the
// session and let the user close/reposition/pin it"; every other action stays on the canvas.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { quantizeCharSize } from '../terminal/char-size-quantize'
import { LocalTransport } from '../terminal/local-transport'
import { localSession } from '../session/localSession'
import { useSettings } from '../state/settings'
import { activateUnicode11 } from '../terminal/unicode-width'
import { parseOsc52 } from '../terminal/osc52'
import {
  attachReplay,
  cursorPlacementSeq,
  seedPaint,
  stripTrailingNewline,
  terminalKeyAction,
  toXtermText,
  applyLiveOptions,
  xtermOptionsFromSettings,
  SHIFT_ENTER_SEQ,
  CO_ATTACH_MOUSE_SEQ
} from '../terminal/terminal-config'
import type { CanvasWidgetLiveState } from '../../shared/types'
import '@xterm/xterm/css/xterm.css'

function widgetNodeIdFromLocation(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('widget')
}

/** True when this renderer boot should mount `<WidgetApp/>` instead of the full `<App/>`. Read
 *  once at boot (`main.tsx`) — the query string never changes for the lifetime of this window. */
export function isWidgetWindow(): boolean {
  return widgetNodeIdFromLocation() !== null
}

export default function WidgetApp(): React.JSX.Element {
  const nodeId = widgetNodeIdFromLocation() ?? ''
  const hostRef = useRef<HTMLDivElement>(null)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live state (this node's always-on-top choice) — reflects a change made elsewhere (a future
  // second trigger for the same node) without polling.
  useEffect(() => {
    let cancelled = false
    void window.nodeTerminal.canvasWidget.getState(nodeId).then((s: CanvasWidgetLiveState) => {
      if (!cancelled) setAlwaysOnTop(s.alwaysOnTop)
    })
    const unsub = window.nodeTerminal.canvasWidget.onStateChanged((s: CanvasWidgetLiveState) => {
      if (s.nodeId === nodeId) setAlwaysOnTop(s.alwaysOnTop)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [nodeId])

  const toggleAlwaysOnTop = useCallback(() => {
    void window.nodeTerminal.canvasWidget.setAlwaysOnTop(nodeId, !alwaysOnTop)
  }, [nodeId, alwaysOnTop])

  const backToCanvas = useCallback(() => {
    window.nodeTerminal.focusWindow()
    void window.nodeTerminal.canvasWidget.close(nodeId)
  }, [nodeId])

  const close = useCallback(() => {
    void window.nodeTerminal.canvasWidget.close(nodeId)
  }, [nodeId])

  useEffect(() => {
    if (!nodeId) {
      setError('No node id was given to this widget window.')
      return
    }
    let dead = false
    let sessionId: string | null = null
    const cleanups: (() => void)[] = []
    const transport = new LocalTransport()
    const s = useSettings.getState().settings
    const term = new Terminal(xtermOptionsFromSettings(s))
    activateUnicode11(term)
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current!)
    quantizeCharSize(term)
    fit.fit()

    void (async () => {
      const res = await transport.create({
        cols: term.cols,
        rows: term.rows,
        persistKey: nodeId
      })
      if (dead) return
      if (res.unavailable) {
        term.write('\r\n\x1b[90m[not connected — nothing was started locally]\x1b[0m\r\n')
        return
      }
      if (res.closed) {
        term.write('\r\n\x1b[90m[session closed]\x1b[0m\r\n')
        return
      }
      sessionId = res.sessionId
      cleanups.push(transport.onData(res.sessionId, (d) => term.write(d)))
      cleanups.push(
        transport.onExit(res.sessionId, () => term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n'))
      )
      if (transport.onSize)
        cleanups.push(transport.onSize(res.sessionId, (size) => term.resize(size.cols, size.rows)))
      term.onData((d) => {
        if (sessionId) transport.write(sessionId, d)
      })
      term.attachCustomKeyEventHandler((e) => {
        const action = terminalKeyAction(e, false)
        if (action === 'shift-enter' && sessionId) {
          transport.write(sessionId, SHIFT_ENTER_SEQ)
          return false
        }
        return true
      })
      // `localSession`, not the bare global: the widget is deliberately local-only (it builds its
      // own LocalTransport above), and routing through the session layer is what SAYS so instead
      // of leaving it as an incidental property of which object happened to be in scope. The
      // escape button in TerminalNode.tsx will not offer a widget for a remote node at all.
      const snapshot = res.fresh ? await localSession.api.pty.readScrollback(nodeId) : null
      if (dead) return
      const paint = seedPaint({
        replay: attachReplay({ parked: false, fresh: res.fresh, hasInitialCommand: false }),
        superseded: false,
        snapshot,
        screen: res.screen
      })
      if (paint === 'snapshot') {
        if (snapshot) term.write(toXtermText(snapshot))
        term.write('\r\n\x1b[90m— session restored —\x1b[0m\r\n')
      } else if (paint === 'create-screen' && res.screen) {
        term.write('\x1b[0m' + toXtermText(stripTrailingNewline(res.screen)))
        term.write(cursorPlacementSeq(res.cursor))
      }
      if (res.coAttachMouse) term.write(CO_ATTACH_MOUSE_SEQ)

      const ro = new ResizeObserver(() => {
        fit.fit()
        if (sessionId) transport.resize(sessionId, term.cols, term.rows)
      })
      ro.observe(hostRef.current!)
      cleanups.push(() => ro.disconnect())
      transport.resize(res.sessionId, term.cols, term.rows)
      term.focus()
    })().catch((err: unknown) => {
      if (dead) return
      setError(err instanceof Error ? err.message : String(err))
    })

    const disposeOsc = term.parser.registerOscHandler(52, (data) => {
      const text = parseOsc52(data)
      if (text != null) void window.nodeTerminal.clipboard.writeText(text)
      return true
    })

    return () => {
      dead = true
      cleanups.forEach((fn) => fn())
      disposeOsc.dispose()
      // Kill ONLY this window's own view of the session — the exact same "second subscriber
      // detaches" contract `ModalTerminal` uses. The tmux/session-host session keeps running.
      if (sessionId) transport.kill(sessionId)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  // Live-apply appearance settings, mirroring the canvas node/modal.
  const fontSize = useSettings((s) => s.settings.fontSize)
  const fontFamily = useSettings((s) => s.settings.fontFamily)
  useEffect(() => {
    void fontSize
    void fontFamily
    // applyLiveOptions reads the live xterm instance itself; nothing to do here beyond
    // re-rendering, which the settings subscription above already triggers.
  }, [fontSize, fontFamily])
  void applyLiveOptions // referenced so a future live-apply wire-up has an obvious anchor

  return (
    <div className="widget-app">
      <div className="widget-app__titlebar">
        <span className="widget-app__drag" />
        <button
          type="button"
          className="widget-app__btn"
          aria-label={alwaysOnTop ? 'Turn off always on top' : 'Keep this widget on top'}
          aria-pressed={alwaysOnTop}
          onClick={toggleAlwaysOnTop}
        >
          {alwaysOnTop ? '📌' : '📍'}
        </button>
        <button
          type="button"
          className="widget-app__btn"
          aria-label="Back to canvas"
          onClick={backToCanvas}
        >
          ⤢
        </button>
        <button type="button" className="widget-app__btn" aria-label="Close widget" onClick={close}>
          ×
        </button>
      </div>
      {error ? <div className="widget-app__error">{error}</div> : null}
      <div ref={hostRef} className="widget-app__term" />
    </div>
  )
}
