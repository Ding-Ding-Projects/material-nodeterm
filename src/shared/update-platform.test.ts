import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { shouldEnableUpdater, updateDelivery } from './update-platform'

describe('shouldEnableUpdater', () => {
  it('disables checks in development and in explicitly local packaged builds', () => {
    expect(shouldEnableUpdater(false, undefined)).toBe(false)
    expect(shouldEnableUpdater(true, 'disabled')).toBe(false)
  })

  it('enables checks for normal packaged releases', () => {
    expect(shouldEnableUpdater(true, undefined)).toBe(true)
    expect(shouldEnableUpdater(true, 'enabled')).toBe(true)
  })
})

describe('updateDelivery', () => {
  it('reports a packaged build with updates switched off as having no channel, never as current', () => {
    expect(updateDelivery({ isPackaged: true, updateMode: 'disabled' })).toBe('no-channel')
  })

  it('keeps an unpackaged run quiet and a normal packaged release on the self-install path', () => {
    expect(updateDelivery({ isPackaged: false, updateMode: 'disabled' })).toBe('dev')
    expect(updateDelivery({ isPackaged: false, updateMode: undefined })).toBe('dev')
    expect(updateDelivery({ isPackaged: true, updateMode: undefined })).toBe('self-install')
  })
})

describe('Windows release scripts use one packaging route', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
  ) as { scripts: Record<string, string> }

  it('routes both distribution and release through dist:win', () => {
    expect(pkg.scripts.dist).toBe('npm run dist:win')
    expect(pkg.scripts.release).toBe('npm run dist:win')
    expect(pkg.scripts['dist:win']).toBeDefined()
  })

  it('contains no alternate desktop distribution script', () => {
    expect(Object.keys(pkg.scripts).filter((name) => /^dist:(?!win$)/.test(name))).toEqual([])
  })
})
