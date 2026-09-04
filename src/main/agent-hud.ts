// Agent HUD (docs/agent-hud.md) — a small, frameless, always-on-top, click-through tool window
// docked inside the primary display work area, showing walking agent mascots while agents work and
// expanding into a mini session panel. It is a standalone Windows tool window, independent of
// display hardware geometry, and is enabled by default through the Agent HUD setting.
//
// This module owns the BrowserWindow, the getHudWindow/sendToHud singleton, and the mirror/IPC
// subscriptions. The data folding lives in the pure, Electron-free agent-hud-model.ts so it is
// unit-testable without a window. index.ts feeds the normalized agent-event and context-update
// streams through the module-level agentHudOn* functions.

import { BrowserWindow, ipcMain, screen } from 'electron'
import { IPC } from '../shared/ipc'
import { getMainWindow, sendToMain } from './main-window'
import { desktopBuildPaths } from './desktop-build-paths'
import {
  onNodeStateChange,
  onNodeNowChange,
  onMirrorFlush,
  type NodeStateChange,
  type NodeNowChange,
  type MirrorFile
} from '../core/agent-status-mirror'
import type { NormalizedAgentEvent } from '../shared/agents/normalize'
import { createHudModel, type HudModel } from './agent-hud-model'

/** Bounds for the user-tunable collapsed indicator width. */
export const AGENT_HUD_WIDTH_MIN = 100
export const AGENT_HUD_WIDTH_MAX = 320
const AGENT_HUD_WIDTH_DEFAULT = 168
/**
 * Window WIDTH (px): the expanded panel is 400px wide (hud.css --panel-width) plus its 44px blur
 * shadow on each side. 560 leaves that whole paint inside the window — a narrower window would
 * clip the expanded panel's edges, which reads as a rendering bug rather than a size choice.
 */
const HUD_WINDOW_WIDTH = 560
/** Total tool-window height. The renderer expands within this fixed, independent surface. */
const HUD_WINDOW_HEIGHT = 460
/** Debounce for coalescing feed changes into one push to the HUD renderer. */
const PUSH_DEBOUNCE_MS = 150
/** Low-frequency sweep so stale (gone + idle > 6h) nodes drop even with no live events. */
// Also the tick that lets the model's working watchdog and the relative times age without events.
const SWEEP_MS = 60 * 1000

// ---- Singleton (mirror main-window.ts) -----------------------------------------------------

let hudWin: BrowserWindow | null = null

export function getHudWindow(): BrowserWindow | null {
  return hudWin && !hudWin.isDestroyed() ? hudWin : null
}

export function sendToHud(channel: string, ...args: unknown[]): void {
  getHudWindow()?.webContents.send(channel, ...args)
}

// ---- Controller ----------------------------------------------------------------------------

export interface AgentHudDeps {
  /** Sync in-memory node title (workspaceStore.getNodeTitle). */
  getNodeTitle: (nodeId: string) => string | undefined
  /** Shared School-mode snapshot. Unhydrated keeps non-React vocabulary mapping fail-closed. */
  getSchoolMode: () => { enabled: boolean; hydrated: boolean }
}

/** The user-tunable part of the HUD (Settings → Interface). Applied live, no restart. */
export interface AgentHudTunables {
  enabled: boolean
  /** Collapsed indicator width in px. */
  agentHudWidth: number
  /** Expand the panel on hover (else click-only). */
  hoverExpand: boolean
  /** settings.usagePercentMode — how the rows' context percentages render ("42% used" / "58% left"). */
  percentMode: 'used' | 'remaining' | 'tokens'
}

/** Clamp a hand-editable width to something that can't push the pill off the window. */
function sanitizeAgentHudWidth(px: number): number {
  return Number.isFinite(px)
    ? Math.max(AGENT_HUD_WIDTH_MIN, Math.min(AGENT_HUD_WIDTH_MAX, Math.round(px)))
    : AGENT_HUD_WIDTH_DEFAULT
}

class AgentHudController {
  private model: HudModel = createHudModel()
  private unsubs: (() => void)[] = []
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private sweepTimer: ReturnType<typeof setInterval> | null = null
  private ipcBound = false
  private readonly onSetIgnoreMouse: (_e: unknown, ignore: boolean) => void
  private readonly onFocusNode: (_e: unknown, nodeId: string) => void
  private readonly onExpanded: () => void
  private readonly onDismiss: (_e: unknown, nodeId: string) => void
  private readonly onDisplayChange: () => void

  constructor(
    private deps: AgentHudDeps,
    private tunables: { agentHudWidth: number; hoverExpand: boolean; percentMode: 'used' | 'remaining' | 'tokens' }
  ) {
    this.onSetIgnoreMouse = (_e, ignore) => {
      // Ignore-mouse ON = click-through (the strip is transparent to the app beneath); OFF while the
      // pointer is over the hotspot/panel so clicks land. `forward` keeps move events flowing so the
      // renderer still sees pointer-leave to re-enable click-through.
      getHudWindow()?.setIgnoreMouseEvents(!!ignore, { forward: true })
    }
    this.onFocusNode = (_e, nodeId) => {
      if (typeof nodeId !== 'string' || !nodeId) return
      // Reuse the notification-click focus path: bring the main window forward + ask the renderer to
      // center the node, then clear its done highlight (a nodeterm-native "you looked at it").
      const w = getMainWindow()
      if (w) {
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
        sendToMain(IPC.appFocusNode, nodeId)
      }
      this.model.noteFocus(nodeId)
      this.schedulePush()
    }
    this.onDismiss = (_e, nodeId) => {
      if (typeof nodeId !== 'string' || !nodeId) return
      this.model.dismiss(nodeId)
      this.schedulePush()
    }
    // NOTE: opening/closing the panel deliberately marks NOTHING as read. It used to clear every
    // done latch on close ("you looked at it"), which lost the plot with three finished sessions
    // waiting: open the panel, click one, and the other two silently vanished unread. Read is now
    // strictly per row — clicking/Go-ing a row clears that row (onFocusNode), and the × dismisses
    // one by hand. The event is still wired because the renderer's expand state may drive more here.
    this.onExpanded = () => {}
    this.onDisplayChange = () => this.reposition()
  }

  start(): void {
    this.createWindow()
    this.bindIpc()
    this.unsubs.push(onNodeStateChange((c: NodeStateChange) => this.onModelChange(() => this.model.applyStateChange(c))))
    this.unsubs.push(onNodeNowChange((c: NodeNowChange) => this.onModelChange(() => this.model.applyNowChange(c))))
    this.unsubs.push(onMirrorFlush((doc: MirrorFile) => this.onModelChange(() => this.model.applyMirrorFlush(doc))))
    screen.on('display-metrics-changed', this.onDisplayChange)
    screen.on('display-added', this.onDisplayChange)
    screen.on('display-removed', this.onDisplayChange)
    this.sweepTimer = setInterval(() => {
      // Always re-push: the working watchdog and the relative timestamps both age with the clock,
      // so a row has to be able to change with no incoming event at all.
      this.model.prune(Date.now())
      this.schedulePush()
    }, SWEEP_MS)
    this.sweepTimer.unref?.()
  }

  stop(): void {
    for (const u of this.unsubs) {
      try {
        u()
      } catch {
        /* ignore */
      }
    }
    this.unsubs = []
    screen.removeListener('display-metrics-changed', this.onDisplayChange)
    screen.removeListener('display-added', this.onDisplayChange)
    screen.removeListener('display-removed', this.onDisplayChange)
    if (this.pushTimer) {
      clearTimeout(this.pushTimer)
      this.pushTimer = null
    }
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    this.unbindIpc()
    if (hudWin && !hudWin.isDestroyed()) hudWin.destroy()
    hudWin = null
  }

  /** Feed the normalized agent-event stream (prompt on newTurn + subagent grouping). */
  onAgentEvent(ev: NormalizedAgentEvent): void {
    this.onModelChange(() => this.model.applyAgentEvent(ev))
  }

  /** Feed a provider/source-qualified context update with validated numerator and denominator. */
  onContextUpdate(p: { sessionId?: string; agentId?: string; source?: string; model?: string; usedTokens?: number; windowTokens?: number; updatedAt?: number }): void {
    this.onModelChange(() => this.model.applyContextUpdate(p))
  }

  private onModelChange(mutate: () => void): void {
    try {
      mutate()
    } catch {
      // A malformed event must never crash the HUD (or the main process).
      return
    }
    this.schedulePush()
  }

  private bindIpc(): void {
    if (this.ipcBound) return
    ipcMain.on(IPC.hudSetIgnoreMouse, this.onSetIgnoreMouse)
    ipcMain.on(IPC.hudFocusNode, this.onFocusNode)
    ipcMain.on(IPC.hudExpanded, this.onExpanded)
    ipcMain.on(IPC.hudDismiss, this.onDismiss)
    this.ipcBound = true
  }

  private unbindIpc(): void {
    if (!this.ipcBound) return
    ipcMain.removeListener(IPC.hudSetIgnoreMouse, this.onSetIgnoreMouse)
    ipcMain.removeListener(IPC.hudFocusNode, this.onFocusNode)
    ipcMain.removeListener(IPC.hudExpanded, this.onExpanded)
    ipcMain.removeListener(IPC.hudDismiss, this.onDismiss)
    this.ipcBound = false
  }

  /** Apply live tunables and re-push, so a slider drag moves the capsule as you drag. */
  setTunables(t: { agentHudWidth: number; hoverExpand: boolean; percentMode: 'used' | 'remaining' | 'tokens' }): void {
    this.tunables = { agentHudWidth: t.agentHudWidth, hoverExpand: t.hoverExpand, percentMode: t.percentMode }
    this.schedulePush()
  }

  /** Position a fixed standalone tool window inside the primary display work area. */
  private geometry(): {
    x: number
    y: number
    width: number
    height: number
    agentHudWidth: number
  } {
    const wa = screen.getPrimaryDisplay().workArea
    const width = Math.min(HUD_WINDOW_WIDTH, Math.max(320, wa.width - 32), wa.width)
    const height = Math.min(HUD_WINDOW_HEIGHT, Math.max(240, wa.height - 32), wa.height)
    return {
      x: wa.x + Math.max(16, wa.width - width - 24),
      y: wa.y + 24,
      width,
      height,
      agentHudWidth: sanitizeAgentHudWidth(this.tunables.agentHudWidth)
    }
  }

  private reposition(): void {
    const w = getHudWindow()
    if (!w) return
    const g = this.geometry()
    w.setBounds({ x: g.x, y: g.y, width: g.width, height: g.height })
    this.schedulePush() // re-send geometry (work area changes with taskbar/display layout)
  }

  private createWindow(): void {
    if (getHudWindow()) return
    const g = this.geometry()
    const buildPaths = desktopBuildPaths(__dirname)
    const win = new BrowserWindow({
      x: g.x,
      y: g.y,
      width: g.width,
      height: g.height,
      frame: false,
      transparent: true,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      // Never focusable: the HUD is a passive overlay, and a focusable overlay would steal the
      // keystroke the user was typing into a terminal the moment a row pushed.
      focusable: false,
      // Tool window: out of the taskbar and Alt-Tab — a status overlay that shows up as a
      // switchable "app" reads as a stuck ghost window.
      skipTaskbar: true,
      type: 'toolbar',
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: buildPaths.hudPreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    hudWin = win
    // Screen-saver level keeps the pill above ordinary always-on-top windows (e.g. picture-in-
    // picture players) — a status overlay that can be covered silently is one nobody trusts.
    win.setAlwaysOnTop(true, 'screen-saver')
    // Passive by default: the strip is click-through; the renderer flips this OFF over the hotspot.
    win.setIgnoreMouseEvents(true, { forward: true })

    win.on('closed', () => {
      if (hudWin === win) hudWin = null
    })

    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      void win.loadURL(`${devUrl}/hud.html`)
    } else {
      void win.loadFile(buildPaths.hudRenderer)
    }
    win.webContents.on('did-finish-load', () => {
      win.showInactive() // show without stealing focus
      this.pushNow()
    })
  }

  schedulePush(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.pushNow()
    }, PUSH_DEBOUNCE_MS)
    this.pushTimer.unref?.()
  }

  private pushNow(): void {
    const w = getHudWindow()
    if (!w) return
    const now = Date.now()
    this.model.prune(now)
    const rows = this.model.buildRows(now, this.deps.getNodeTitle)
    const g = this.geometry()
    w.webContents.send(IPC.hudRows, {
      rows,
      ...this.deps.getSchoolMode(),
      agentHudWidth: g.agentHudWidth,
      hoverExpand: this.tunables.hoverExpand,
      percentMode: this.tunables.percentMode
    })
  }
}

// ---- Module-level lifecycle + feed shims ---------------------------------------------------

let controller: AgentHudController | null = null
let controllerDeps: AgentHudDeps | null = null

/**
 * Whether the HUD is supported on this platform. The Linux Server Edition never reaches this
 * module because it is part of the desktop shell. Keeping the tool Windows-only preserves the
 * product's active desktop delivery scope.
 */
function supported(): boolean {
  return process.platform === 'win32'
}

/**
 * Create the HUD (if win32 + enabled). Idempotent. `deps.getNodeTitle` is retained so a later
 * `setAgentHudEnabled(true)` can recreate it without re-plumbing.
 */
export function initAgentHud(deps: AgentHudDeps, t: AgentHudTunables): void {
  controllerDeps = deps
  if (!supported() || !t.enabled) return
  if (controller) return
  controller = new AgentHudController(deps, t)
  controller.start()
}

/**
 * Live settings apply: create/destroy the window on the enable toggle, and push the geometry
 * tunables (pill width, hover-expand) straight through to a running HUD — no restart, so the
 * width slider can be dragged while watching the pill move.
 */
export function applyAgentHudSettings(t: AgentHudTunables): void {
  if (!supported()) return
  if (!t.enabled) {
    controller?.stop()
    controller = null
    return
  }
  if (controller) {
    controller.setTunables(t)
    return
  }
  if (!controllerDeps) return
  controller = new AgentHudController(controllerDeps, t)
  controller.start()
}

/** Tear the HUD down (app quit). */
export function destroyAgentHud(): void {
  controller?.stop()
  controller = null
}

/** Feed shims — cheap no-ops when the HUD is off. Called unconditionally from index.ts. */
export function agentHudOnAgentEvent(ev: NormalizedAgentEvent): void {
  controller?.onAgentEvent(ev)
}
export function agentHudOnContextUpdate(p: {
  sessionId?: string
  agentId?: string
  source?: string
  model?: string
  usedTokens?: number
  windowTokens?: number
  updatedAt?: number
}): void {
  controller?.onContextUpdate(p)
}

/** Push the current HUD snapshot immediately when the shared School-mode record changes. */
export function agentHudOnSchoolModeChange(): void {
  controller?.schedulePush()
}
