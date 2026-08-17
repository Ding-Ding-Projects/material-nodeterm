// Auto-update orchestration. Windows artifacts use Squirrel.Windows and therefore Electron's
// built-in autoUpdater; macOS/AppImage keep electron-updater's deliberately separate backend.
import { app, autoUpdater as squirrelAutoUpdater, ipcMain, Notification } from 'electron'
import { IPC } from '../shared/ipc'
import { isManualUpdatePlatform, toUpdateAvailablePayload } from '../shared/update-platform'
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
 * The window is resolved AT EVENT TIME—never captured in an updater closure. On macOS the window
 * can be recreated while an update downloads. Electron's `before-quit-for-update` event flips the
 * caller's quitting flag only after the updater has actually started, so a failed restart can retry.
 */
export function initUpdater(onBeforeRestart?: () => void): void {
  const send = (channel: string, payload?: unknown) => sendToMain(channel, payload)
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())

  if (!app.isPackaged) {
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
