import { describe, expect, it } from 'vitest'
import {
  normalizeUniGetUiPackage,
  parseUniGetUiPackageList,
  parseUniGetUiSetting
} from './unigetui'

describe('UniGetUI renderer response decoders', () => {
  it('accepts a setting only when its value and secure marker are typed', () => {
    expect(parseUniGetUiSetting({ key: 'updates.enabled', value: true, secure: false })).toEqual({
      key: 'updates.enabled',
      value: true,
      secure: false
    })
    expect(parseUniGetUiSetting(null)).toBeNull()
    expect(() => parseUniGetUiSetting({ key: 'updates.enabled', value: { enabled: true }, secure: false })).toThrow(
      'malformed setting response'
    )
  })

  it('normalizes absent nullable package metadata without accepting invalid fields', () => {
    expect(normalizeUniGetUiPackage({ id: 'pkg.demo', name: 'Demo' })).toEqual({
      id: 'pkg.demo',
      name: 'Demo',
      manager: null,
      source: null,
      version: null,
      installedVersion: null,
      description: null,
      publisher: null,
      url: null
    })
    expect(normalizeUniGetUiPackage({ id: 'pkg.demo', name: 7 })).toBeNull()
  })

  it('rejects a malformed package envelope or package record', () => {
    expect(() => parseUniGetUiPackageList({ items: [] })).toThrow('malformed package list response')
    expect(() => parseUniGetUiPackageList([{ id: 'pkg.demo', manager: [] }])).toThrow('malformed package record')
    expect(parseUniGetUiPackageList([])).toEqual([])
  })
})
