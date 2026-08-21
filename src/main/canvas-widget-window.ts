/**
 * "Escape to widget" — pop one terminal node's live session out of the canvas into its own
 * always-on-top-configurable desktop window (Electron-only; see `CanvasWidgetApi`'s doc comment
 * in shared/types.ts for the user-facing contract and `core/canvas-widget.ts` for the pure
 * bounds/state logic this module applies).
 *
 * The widget window is loaded from the SAME renderer bundle + SAME preload as the main window
 * (`desktopBuildPaths().mainRenderer` / `mainPreload`), with a `?widget=<nodeId>` query string.
 * `renderer/main.tsx`'s bootstrap reads that query string BEFORE mounting `<App/>` and mounts the
 * trimmed-down `<WidgetApp/>` instead — so the widget window never loads the full canvas, the
 * workspace store, or re-reads/re-writes `project.json`; it just co-attaches to the ONE node's
 * tmux/session-host session, exactly the way the kanban card modal's `ModalTerminal` co-attaches
 * a SECOND live view of a session already open on the canvas (see `ModalTerminal.tsx`'s module
 * doc — this is the same "one pty, N subscribers" mechanism, just in a second OS window instead
 * of a second React mount in the same window). Because it is a real second subscriber, closing
 * the widget window NEVER kills the underlying session: this module never calls `pty:destroy` /
 * `pty:recycle` on close, only `ptyManager.dropClient(webContentsId)` to release that ONE view's
 * subscription (mirrors what `main/index.ts`'s main-window `closed` handler already does for the
 * main window — see its comment on `presenceId`/`dropClient`).
 *
 * Position/size persist per node (`Settings.canvasWidgets[nodeId].bounds`), debounced while the
 * user drags/resizes so a save does not fire on every pixel. Always-on-top is user-configurable
 * both at open time (carried over from the node's last choice) and live while the widget is open.
 */

import { BrowserWindow, ipcMain, screen } from 'electron'
import { IPC } from '../shared/ipc'
import type { CanvasWidgetLiveState } from '../shared/types'
import type { SettingsStore } from '../core/settings-store'
import { resolveOpenBounds, WIDGET_MIN_HEIGHT, WIDGET_MIN_WIDTH } from '../core/canvas-widget'
import type { DesktopBuildPaths } from './desktop-build-paths'

/** Minimal surface this module needs off PtyManager — kept narrow so this file's own tests (were
 *  it not Electron-bound) and any future caller can pass a fake without dragging in the real
 *  class. dropClient releases ONE subscriber's view of a session; it never destroys the session. */
export interface CanvasWidgetPtyDeps {
  dropClient(clientId: number): void
}

const windows = new Map<string, BrowserWindow>()
const boundsSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Debounce window move/resize saves so dragging a widget doesn't write settings.json on every
 *  intermediate frame — mirrors the debounce style used elsewhere in this codebase (scrollback
 *  snapshots, mirror flushes) rather than inventing a new cadence. */
const BOUNDS_SAVE_DEBOUNCE_MS = 500

function isLive(win: BrowserWindow | undefined): win is BrowserWindow {
  return !!win && !win.isDestroyed()
}

function liveState(settingsStore: SettingsStore, nodeId: string): CanvasWidgetLiveState {
  const saved = settingsStore.get().canvasWidgets[nodeId]
  return {
    nodeId,
    open: isLive(windows.get(nodeId)),
    alwaysOnTop: saved?.alwaysOnTop ?? false,
    bounds: saved?.bounds
  }
}

/** Every live window gets the update — the main window (for the node's "escaped" chip) and the
 *  widget window itself (so an always-on-top change made elsewhere, e.g. a future second trigger,
 *  reflects in its own toggle without polling). Broadcasting to windows that have nothing wired to
 *  this channel is harmless: an unhandled `send` is simply unheard. */
function broadcastState(settingsStore: SettingsStore, nodeId: string): void {
  const state = liveState(settingsStore, nodeId)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.widgetStateChanged, state)
  }
}

function clearBoundsTimer(nodeId: string): void {
  const t = boundsSaveTimers.get(nodeId)
  if (t) {
    clearTimeout(t)
    boundsSaveTimers.delete(nodeId)
  }
}

function scheduleBoundsSave(settingsStore: SettingsStore, nodeId: string, win: BrowserWindow): void {
  clearBoundsTimer(nodeId)
  const t = setTimeout(() => {
    boundsSaveTimers.delete(nodeId)
    if (win.isDestroyed()) return
    const b = win.getBounds()
    void settingsStore.updateCanvasWidget(nodeId, {
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height }
    })
  }, BOUNDS_SAVE_DEBOUNCE_MS)
  boundsSaveTimers.set(nodeId, t)
}

/** Open (or focus, if already open) the widget window for one node. */
export function openCanvasWidget(
  nodeId: string,
  settingsStore: SettingsStore,
  buildPaths: DesktopBuildPaths,
  ptyDeps: CanvasWidgetPtyDeps
): void {
  const existing = windows.get(nodeId)
  if (isLive(existing)) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }

  const saved = settingsStore.get().canvasWidgets[nodeId]
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const bounds = resolveOpenBounds(saved?.bounds, workArea)

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: WIDGET_MIN_WIDTH,
    minHeight: WIDGET_MIN_HEIGHT,
    // Frameless like every other window in this app — WidgetApp draws its own MD3 title bar
    // (drag region + back-to-canvas + always-on-top toggle + close), never the OS chrome.
    frame: false,
    show: false,
    backgroundColor: '#1e1e1e',
    title: 'nodeterm widget',
    alwaysOnTop: saved?.alwaysOnTop ?? false,
    webPreferences: {
      preload: buildPaths.mainPreload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  windows.set(nodeId, win)

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    const url = new URL(devUrl)
    url.searchParams.set('widget', nodeId)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(buildPaths.mainRenderer, { query: { widget: nodeId } })
  }

  win.once('ready-to-show', () => win.show())
  win.on('resize', () => scheduleBoundsSave(settingsStore, nodeId, win))
  win.on('move', () => scheduleBoundsSave(settingsStore, nodeId, win))
  // Capture the id before 'closed' — reading webContents on a destroyed window throws, same
  // caution as the main window's own 'closed' handler in main/index.ts.
  const webContentsId = win.webContents.id
  win.on('closed', () => {
    windows.delete(nodeId)
    clearBoundsTimer(nodeId)
    // Release THIS view's pty subscription only. The tmux/session-host session this window was
    // co-attached to keeps running — exactly as it does when a canvas TerminalNode is merely
    // unmounted (park/offscreen release) or when the main window itself closes. No pty:destroy,
    // no pty:recycle: closing the widget must never end the session.
    try {
      ptyDeps.dropClient(webContentsId)
    } catch {
      /* best-effort cleanup only */
    }
    broadcastState(settingsStore, nodeId)
  })

  broadcastState(settingsStore, nodeId)
}

/** Close the widget window for one node. A no-op if it isn't open. */
export function closeCanvasWidget(nodeId: string): void {
  const win = windows.get(nodeId)
  if (isLive(win)) win.close()
}

/** Persist + apply (if currently open) always-on-top for one node's widget. */
export function setCanvasWidgetAlwaysOnTop(
  nodeId: string,
  alwaysOnTop: boolean,
  settingsStore: SettingsStore
): void {
  void settingsStore.updateCanvasWidget(nodeId, { alwaysOnTop }).then(() => {
    broadcastState(settingsStore, nodeId)
  })
  const win = windows.get(nodeId)
  if (isLive(win)) win.setAlwaysOnTop(alwaysOnTop, 'floating')
}

/** Destroy every open widget window without touching any session — used only at app quit, mirror
 *  of `PtyManager.killAll()`'s "detach, never kill the session" contract. */
export function closeAllCanvasWidgets(): void {
  for (const win of windows.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
  windows.clear()
  for (const t of boundsSaveTimers.values()) clearTimeout(t)
  boundsSaveTimers.clear()
}

export function registerCanvasWidgetIpc(
  settingsStore: SettingsStore,
  buildPaths: DesktopBuildPaths,
  ptyDeps: CanvasWidgetPtyDeps
): void {
  ipcMain.handle(IPC.widgetOpen, (_e, nodeId: unknown) => {
    if (typeof nodeId !== 'string' || !nodeId) return
    openCanvasWidget(nodeId, settingsStore, buildPaths, ptyDeps)
  })
  ipcMain.handle(IPC.widgetClose, (_e, nodeId: unknown) => {
    if (typeof nodeId !== 'string' || !nodeId) return
    closeCanvasWidget(nodeId)
  })
  ipcMain.handle(IPC.widgetSetAlwaysOnTop, (_e, nodeId: unknown, alwaysOnTop: unknown) => {
    if (typeof nodeId !== 'string' || !nodeId) return
    setCanvasWidgetAlwaysOnTop(nodeId, alwaysOnTop === true, settingsStore)
  })
  ipcMain.handle(IPC.widgetGetState, (_e, nodeId: unknown) => {
    if (typeof nodeId !== 'string' || !nodeId) {
      return { nodeId: '', open: false, alwaysOnTop: false } satisfies CanvasWidgetLiveState
    }
    return liveState(settingsStore, nodeId)
  })
}
