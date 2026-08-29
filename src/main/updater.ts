// Auto-update orchestration. Windows artifacts use Squirrel.Windows and therefore Electron's
// built-in autoUpdater; macOS/AppImage keep electron-updater's deliberately separate backend.
import { app, autoUpdater as squirrelAutoUpdater, ipcMain, Notification } from 'electron'
import fs from 'fs'
import path from 'path'
// Auto-update client (electron-updater). The packaged app downloads updates automatically
// and forwards the full lifecycle (available → progress → downloaded → error/not-available)
// to the renderer's UpdateCard. Version lookup, manual check, and restart work in dev too;
// the automatic feed checks and event wiring are packaged-only. On macOS, silent self-install
// requires a signed + notarized build; unsigned builds still surface the card for a manual
// download.
import { app, ipcMain, Notification } from 'electron'
import fs from 'fs'
import path from 'path'
// Named import — the default-import + destructure pattern returns undefined under
// electron-vite v5's CJS interop.
import { autoUpdater } from 'electron-updater'
import { IPC } from '../shared/ipc'
import {
  isManualUpdatePlatform,
  shouldEnableUpdater,
  toUpdateAvailablePayload
} from '../shared/update-platform'
import { getMainWindow, sendToMain } from './main-window'
import { retainUntilDismissed } from './notifications'
import {
  createInstallGate,
  createWindowsSquirrelController,
  registerBeforeQuitForUpdate,
  updaterProtocolFor,
  type SquirrelBackend,
  type SquirrelUpdateSink
} from './squirrel-updater'
import { initialAutomaticUpdateDelayMs } from './squirrel-startup'
import {
  createNonWindowsUpdateRequestArbiter,
  wireNonWindowsUpdateLifecycle
} from './non-windows-updater'

const SIX_HOURS = 6 * 60 * 60 * 1000

function notifyUpdateReady(version?: string): void {
  // Resolve the window at event time. A close→dock-reopen can replace it while downloading.
  if (getMainWindow()?.isFocused() || !Notification.isSupported()) return
  const notification = new Notification({
    title: 'Update ready',
    body: version
      ? `nodeterm ${version} is ready to install.`
      : 'A nodeterm update is ready to install.'
  })
  notification.on('click', () => {
    const window = getMainWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  // Keep a reference or GC silently kills the click handler (electron/electron#16922).
  retainUntilDismissed(notification)
  notification.show()
}

function squirrelBackend(): SquirrelBackend {
  return {
    setFeedURL(url) {
      squirrelAutoUpdater.setFeedURL({ url })
    },
    checkForUpdates() {
      squirrelAutoUpdater.checkForUpdates()
    },
    quitAndInstall() {
      squirrelAutoUpdater.quitAndInstall()
    },
    onAvailable(listener) {
      squirrelAutoUpdater.on('update-available', listener)
    },
    onNotAvailable(listener) {
      squirrelAutoUpdater.on('update-not-available', listener)
    },
    onDownloaded(listener) {
      squirrelAutoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
        listener(releaseName)
      })
    },
    onError(listener) {
      squirrelAutoUpdater.on('error', listener)
    }
  }
}

function loadBuilderAutoUpdater(): typeof import('electron-updater')['autoUpdater'] {
  // Loading electron-updater constructs its NSIS backend on Windows. Keep the dependency behind
  // the platform branch so a Squirrel.Windows process never even creates that incompatible client.
  return (require('electron-updater') as typeof import('electron-updater')).autoUpdater
}

/**
 * The `nodeTermUpdates` marker a LOCAL package carries in its packaged package.json, injected by
 * the mac/Linux `dist`/`dist:linux` scripts via electron-builder's `extraMetadata`. `release` (the
 * mac promotion build) and the Windows `dist:win` path — which is also this fork's real CI release
 * build — never set it, so a promoted build of any kind is untouched and keeps updating itself.
 *
 * It exists because a locally packaged app is indistinguishable from a release at runtime —
 * `app.isPackaged` is true for both — so it polled the production feed for a version that was
 * never published there and logged a 404 on `latest*.yml` every six hours.
 *
 * The trade-off, stated plainly: a `dist`/`dist:linux` package can no longer smoke-test the
 * updater wiring itself — a manual check there now answers "up to date" without going near the
 * network. The old behaviour at least proved the wiring was live, at the cost of a recurring 404
 * in every local build's log. Verifying the real feed is the job of a promoted package, which
 * carries no marker.
 */
function packagedUpdateMode(): unknown {
  if (!app.isPackaged) return undefined
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as {
      nodeTermUpdates?: unknown
    }
    return pkg.nodeTermUpdates
  } catch (err) {
    // A normal release without the marker must preserve the established updater behavior.
    console.warn('[updater] could not read packaged update mode:', err)
    return undefined
  }
}

/**
 * The window is resolved AT EVENT TIME (getMainWindow/sendToMain) — never captured in a closure.
 * On macOS the window can be closed (the app lives on) and recreated from the dock, so a captured
 * reference is a DESTROYED window: touching it throws `TypeError: Object has been destroyed`. That
 * shipped — an update finishing downloading after a close→dock-reopen crashed the main process on
 * `win.isFocused()`. Electron's `before-quit-for-update` event flips the caller's quitting flag
 * only after the updater has actually started, so a failed restart can retry.
 *
 * @param onBeforeRestart Run right before `quitAndInstall()`. Required so the caller can flip its
 *   "quitting" flag: `quitAndInstall()` closes all windows and only then calls `app.quit()`, but
 *   our `win.on('close')` hides the window (keeps the app alive) unless we're already quitting — so
 *   without this the window just hides, `app.quit()` never fires, and the update never installs.
 */
export function initUpdater(onBeforeRestart?: () => void): void {
  const send = (channel: string, payload?: unknown) => sendToMain(channel, payload)
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())

  if (!shouldEnableUpdater(app.isPackaged, packagedUpdateMode())) {
    // Dev and explicitly local/unsigned packages have no update channel. A manual check reports
    // "up to date" for feedback; automatic networking and updater event wiring stay disabled.
    ipcMain.on(IPC.appRestartToUpdate, () => undefined)
    ipcMain.on(IPC.appCheckForUpdates, () => send(IPC.appUpdateNotAvailable))
    return
  }

  // electron-updater 6.8.9 deliberately emulates Electron's same event from BaseUpdater only
  // after its install launch succeeds. One built-in listener therefore covers Windows Squirrel
  // and the retained macOS/AppImage backend without setting `quitting` on a thrown launch.
  registerBeforeQuitForUpdate(
    (listener) => squirrelAutoUpdater.once('before-quit-for-update', listener),
    onBeforeRestart
  )

  if (updaterProtocolFor(process.platform) === 'squirrel-windows') {
    const sink: SquirrelUpdateSink = {
      available: (info) => send(IPC.appUpdateAvailable, info),
      downloaded: (info) => {
        send(IPC.appUpdateDownloaded, info)
        notifyUpdateReady(info.version)
      },
      notAvailable: () => send(IPC.appUpdateNotAvailable),
      error: (message) => send(IPC.appUpdateError, message),
      logError: (message) => console.error('[updater]', message)
    }
    const controller = createWindowsSquirrelController({
      appVersion: app.getVersion(),
      fixtureURL: process.env.NODETERM_SQUIRREL_FIXTURE_URL,
      backend: squirrelBackend(),
      sink
    })

    ipcMain.on(IPC.appCheckForUpdates, () => controller.check(true))
    ipcMain.on(IPC.appRestartToUpdate, () => controller.restart())

    const automaticCheck = () => controller.check(false)
    const delay = initialAutomaticUpdateDelayMs(process.argv, process.platform)
    if (delay > 0) setTimeout(automaticCheck, delay)
    else automaticCheck()
    setInterval(automaticCheck, SIX_HOURS)
    return
  }

  // A Linux .deb/.rpm install (no APPIMAGE env) cannot self-install. Keep its established
  // manual-download behavior, while AppImage and macOS continue through electron-updater.
  const builderAutoUpdater = loadBuilderAutoUpdater()
  const manualUpdates = isManualUpdatePlatform(process.platform, !!process.env.APPIMAGE)
  builderAutoUpdater.autoDownload = !manualUpdates
  builderAutoUpdater.autoInstallOnAppQuit = !manualUpdates

  const installGate = createInstallGate({
    quitAndInstall: () => builderAutoUpdater.quitAndInstall(),
    onError: (message) => send(IPC.appUpdateError, message)
  })

  const requests = createNonWindowsUpdateRequestArbiter({
    checkForUpdates: () => builderAutoUpdater.checkForUpdates(),
    isCheckBlocked: () => installGate.ready || installGate.installing,
    replayReadyUpdate: () =>
      installGate.replayReady((version) => {
        send(IPC.appUpdateDownloaded, { version })
        notifyUpdateReady(version)
      }),
    sendNotAvailable: () => send(IPC.appUpdateNotAvailable),
    sendError: (detail) => send(IPC.appUpdateError, detail),
    logError: (detail) => console.error('[updater]', detail)
  })

  builderAutoUpdater.on('download-progress', (progress) => {
    send(IPC.appUpdateProgress, {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    })
  })

  wireNonWindowsUpdateLifecycle<
    { version: string; releaseNotes?: unknown },
    { version: string }
  >({
    manualUpdates,
    requests,
    installGate,
    onAvailable: (listener) => builderAutoUpdater.on('update-available', listener),
    onDownloaded: (listener) => builderAutoUpdater.on('update-downloaded', listener),
    onNotAvailable: (listener) => builderAutoUpdater.on('update-not-available', listener),
    onError: (listener) => builderAutoUpdater.on('error', listener),
    downloadedVersion: (info) => info.version,
    forwardAvailable: (info) => {
      send(IPC.appUpdateAvailable, toUpdateAvailablePayload(info, manualUpdates))
    },
    forwardDownloaded: (info) => {
      send(IPC.appUpdateDownloaded, { version: info.version })
      notifyUpdateReady(info.version)
    }
  })

  const check = (manual: boolean): void => void requests.check(manual)

  ipcMain.on(IPC.appCheckForUpdates, () => check(true))
  ipcMain.on(IPC.appRestartToUpdate, () => installGate.restart())
  check(false)
  setInterval(() => check(false), SIX_HOURS)
}
