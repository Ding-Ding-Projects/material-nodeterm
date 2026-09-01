// Windows packages use the unsigned Squirrel.Windows feed and Electron's built-in autoUpdater.
// The packaged app checks on startup and every six hours, while manual checks remain available.
import { app, autoUpdater, ipcMain, Notification } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import { shouldEnableUpdater } from '../shared/update-platform'
import { getMainWindow, sendToMain } from './main-window'
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
    title: 'Update ready',
    body: version
      ? `nodeterm ${version} is ready to install.`
      : 'A nodeterm update is ready to install.'
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
 * A locally packaged build may explicitly disable production feed checks through package metadata.
 * A normal release has no marker and therefore retains the updater.
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
