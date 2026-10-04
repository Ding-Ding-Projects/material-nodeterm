// A packaged build with updates switched off (`nodeTermUpdates=disabled`) used to answer a manual
// "check for updates" with "you are up to date": a statement such a build can never make, because
// it has no feed to look at. The pure decision is pinned in `src/shared/update-platform.test.ts`;
// this pins the WIRING in `initUpdater`, where the false sentence lived. It also pins the paths
// that must not move: an unpackaged dev run stays quiet, and a normal release still wires the
// Squirrel updater.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { IPC } from '../shared/ipc'

const { ipcOn, sent, appMock, squirrel } = vi.hoisted(() => ({
  ipcOn: {} as Record<string, (...a: unknown[]) => void>,
  sent: [] as Array<{ channel: string; payload?: unknown }>,
  appMock: { isPackaged: true, appPath: '' },
  squirrel: {
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
    once: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appMock.isPackaged
    },
    getAppPath: () => appMock.appPath,
    getVersion: () => '1.0.0'
  },
  autoUpdater: squirrel,
  ipcMain: {
    on: (ch: string, fn: (...a: unknown[]) => void) => {
      ipcOn[ch] = fn
    },
    handle: () => undefined
  },
  Notification: Object.assign(function () {}, { isSupported: () => false })
}))
vi.mock('./main-window', () => ({
  getMainWindow: () => null,
  sendToMain: (channel: string, payload?: unknown) => sent.push({ channel, payload })
}))
vi.mock('./notifications', () => ({ retainUntilDismissed: () => {} }))

import { initUpdater } from './updater'

const realReadFileSync = fs.readFileSync

/** Answer the packaged package.json in memory: `undefined` is a normal release (no marker). */
function packageWith(marker: string | undefined): void {
  appMock.appPath = path.join(path.sep, 'fake-app-path')
  const target = path.join(appMock.appPath, 'package.json')
  vi.spyOn(fs, 'readFileSync').mockImplementation(((file: unknown, ...rest: unknown[]) => {
    if (file !== target) return realReadFileSync(file as never, ...(rest as []))
    return JSON.stringify(marker === undefined ? { name: 'x' } : { name: 'x', nodeTermUpdates: marker })
  }) as typeof fs.readFileSync)
}

beforeEach(() => {
  vi.useFakeTimers()
  for (const k of Object.keys(ipcOn)) delete ipcOn[k]
  sent.length = 0
  for (const fn of Object.values(squirrel)) fn.mockClear()
  appMock.isPackaged = true
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const check = (): void => ipcOn[IPC.appCheckForUpdates]?.()
const channels = (): string[] => sent.map((s) => s.channel)

describe('initUpdater update channel wiring', () => {
  it('says a packaged build without a channel has no channel, never that it is up to date', () => {
    packageWith('disabled')
    initUpdater()
    check()
    expect(channels()).toEqual([IPC.appUpdateNoChannel])
    expect(channels()).not.toContain(IPC.appUpdateNotAvailable)
    expect(squirrel.checkForUpdates).not.toHaveBeenCalled()
  })

  it('keeps an unpackaged dev run on the quiet up-to-date reply', () => {
    appMock.isPackaged = false
    initUpdater()
    check()
    expect(channels()).toEqual([IPC.appUpdateNotAvailable])
  })

  it('wires the Squirrel updater for a normal packaged release', () => {
    packageWith(undefined)
    initUpdater()
    expect(squirrel.setFeedURL).toHaveBeenCalled()
    expect(channels()).not.toContain(IPC.appUpdateNoChannel)
  })
})
