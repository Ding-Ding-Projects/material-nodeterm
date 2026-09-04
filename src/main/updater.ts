// Windows packages use the unsigned Squirrel.Windows feed and Electron's built-in autoUpdater.
// The packaged app checks on startup and every six hours, while manual checks remain available.
import { app, autoUpdater, ipcMain, Notification } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import { shouldEnableUpdater } from '../shared/update-platform'
import { getMainWindow, sendToMain } from './main-window'
import { nativeCopyStore } from './native-copy-store'
import { retainUntilDismissed } from './notifications'
import {
  createWindowsSquirrelController,
  registerBeforeQuitForUpdate,
  type SquirrelBackend,
  type SquirrelUpdateSink
} from './squirrel-updater'
import { initialAutomaticUpdateDelayMs } from './squirrel-startup'

const SIX_HOURS = 6 * 60 * 60 * 1000

function notifyUpdateReady(version?: string): void {
  const window = getMainWindow()
  if (window?.isFocused() || !Notification.isSupported()) return
  const notification = new Notification({
    title: nativeCopyStore.get('update.ready', 'Update ready'),
    body: version
      ? `nodeterm ${version} ${nativeCopyStore.get('update.ready.suffix', 'is ready to install.')}`
      : nativeCopyStore.get('update.ready.fallback', 'An update is ready to install.')
  })
  notification.on('click', () => {
    const current = getMainWindow()
    if (!current) return
    if (current.isMinimized()) current.restore()
    current.show()
    current.focus()
  })
  retainUntilDismissed(notification)
  notification.show()
}

function squirrelBackend(): SquirrelBackend {
  return {
    setFeedURL(url) {
      autoUpdater.setFeedURL({ url })
    },
    checkForUpdates() {
      autoUpdater.checkForUpdates()
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall()
    },
    onAvailable(listener) {
      autoUpdater.on('update-available', listener)
    },
    onNotAvailable(listener) {
      autoUpdater.on('update-not-available', listener)
    },
    onDownloaded(listener) {
      autoUpdater.on('update-downloaded', (_event, _notes, releaseName) => {
        listener(releaseName)
      })
    },
    onError(listener) {
      autoUpdater.on('error', listener)
    }
  }
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
  } catch (error) {
    console.warn('[updater] could not read packaged update mode:', error)
    return undefined
  }
}

/**
 * Register the one supported update client. The main window is resolved at event time because a
 * renderer reload can replace it while the download remains active in the main process.
 */
export function initUpdater(onBeforeRestart?: () => void): void {
  const send = (channel: string, payload?: unknown) => sendToMain(channel, payload)
  ipcMain.handle(IPC.appGetVersion, () => app.getVersion())

  if (!shouldEnableUpdater(app.isPackaged, packagedUpdateMode())) {
    ipcMain.on(IPC.appRestartToUpdate, () => undefined)
    ipcMain.on(IPC.appCheckForUpdates, () => send(IPC.appUpdateNotAvailable))
    return
  }

  registerBeforeQuitForUpdate(
    (listener) => autoUpdater.once('before-quit-for-update', listener),
    onBeforeRestart
  )

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
}
