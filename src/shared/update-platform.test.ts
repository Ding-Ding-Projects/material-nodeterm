import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  isManualUpdatePlatform,
  shouldEnableUpdater,
  toUpdateAvailablePayload
} from './update-platform'

describe('isManualUpdatePlatform', () => {
  it('linux with APPIMAGE set → auto (self-installs)', () => {
    expect(isManualUpdatePlatform('linux', true)).toBe(false)
  })

  it('linux without APPIMAGE → manual (.deb/.rpm)', () => {
    expect(isManualUpdatePlatform('linux', false)).toBe(true)
  })

  it('darwin → auto regardless of APPIMAGE', () => {
    expect(isManualUpdatePlatform('darwin', false)).toBe(false)
    expect(isManualUpdatePlatform('darwin', true)).toBe(false)
  })

  it('win32 → auto', () => {
    expect(isManualUpdatePlatform('win32', false)).toBe(false)
  })
})

describe('shouldEnableUpdater', () => {
  it('disables checks in development and in explicitly local packaged builds', () => {
    expect(shouldEnableUpdater(false, undefined)).toBe(false)
    expect(shouldEnableUpdater(true, 'disabled')).toBe(false)
  })

  it('keeps updater behavior unchanged for normal packaged releases', () => {
    expect(shouldEnableUpdater(true, undefined)).toBe(true)
    expect(shouldEnableUpdater(true, 'enabled')).toBe(true)
  })
})

/**
 * `shouldEnableUpdater` is only half the fix — it reads a marker the BUILD has to set. A `dist*`
 * script that forgets it produces a package indistinguishable from a release (`app.isPackaged` is
 * true for both), which then polls the production feed for a version nobody published and logs a
 * 404 on `latest*.yml` every six hours. That is a build-config mistake no unit test of the pure
 * function can catch, so assert it against the real package.json — the same guard-test shape as
 * `src/core/no-electron.test.ts`.
 *
 * `dist:win` is deliberately excluded from this guard. On this fork it is not a local-only smoke
 * script: `.github/workflows/release.yml` runs `npm run dist:win` to build the actual published
 * Windows release, so carrying the marker there would ship every real release with auto-update
 * silently disabled. Its command also never spells `electron-builder` directly — it delegates to
 * `scripts/windows-installer.mjs`, which invokes electron-builder through its own argv, not the
 * `-c.` flag syntax the marker requires — so scoping the guard to scripts that literally invoke
 * `electron-builder` is what naturally keeps it out, without hand-listing script names.
 */
describe('local dist scripts opt out of the production update feed', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
  ) as { scripts: Record<string, string> }
  const MARKER = '-c.extraMetadata.nodeTermUpdates=disabled'
  const distBuilderScripts = Object.keys(pkg.scripts).filter(
    (s) => (s === 'dist' || s.startsWith('dist:')) && pkg.scripts[s].includes('electron-builder')
  )

  it('every dist script that invokes electron-builder directly carries the marker', () => {
    expect(distBuilderScripts.length).toBeGreaterThanOrEqual(2) // dist, dist:linux
    expect(distBuilderScripts.filter((s) => !pkg.scripts[s].includes(MARKER))).toEqual([])
  })

  it('release does NOT carry it — a promoted build must keep updating itself', () => {
    expect(pkg.scripts.release).not.toContain(MARKER)
  })

  it('dist:win does NOT carry it — it is this fork\'s real Windows CI release path too', () => {
    expect(pkg.scripts['dist:win']).toBeDefined()
    expect(pkg.scripts['dist:win']).not.toContain(MARKER)
  })
})

describe('toUpdateAvailablePayload', () => {
  it('carries version + string release notes + manual flag', () => {
    expect(toUpdateAvailablePayload({ version: '1.2.0', releaseNotes: 'fixes' }, true)).toEqual({
      version: '1.2.0',
      notes: 'fixes',
      manual: true
    })
  })

  it('coerces non-string / missing release notes to empty string', () => {
    expect(toUpdateAvailablePayload({ version: '1.2.0' }, false)).toEqual({
      version: '1.2.0',
      notes: '',
      manual: false
    })
    expect(
      toUpdateAvailablePayload({ version: '1.2.0', releaseNotes: [{ note: 'x' }] }, false).notes
    ).toBe('')
  })
})
