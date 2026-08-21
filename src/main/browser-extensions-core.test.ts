import { describe, expect, it } from 'vitest'
import {
  addBrowserExtension,
  allBrowserExtensionEntries,
  browserExtensionsKeyFor,
  emptyBrowserExtensionsStore,
  parseBrowserExtensionsStore,
  parsePersistedBrowserExtensions,
  removeBrowserExtension
} from './browser-extensions-core'

describe('browserExtensionsKeyFor', () => {
  it('maps undefined to the reserved default key', () => {
    expect(browserExtensionsKeyFor(undefined)).toBe('default')
  })

  it('passes a real partition string through unchanged', () => {
    expect(browserExtensionsKeyFor('persist:browser-profile-1')).toBe('persist:browser-profile-1')
  })
})

describe('addBrowserExtension / removeBrowserExtension', () => {
  it('adds a path under a key starting from empty', () => {
    const store = addBrowserExtension(emptyBrowserExtensionsStore(), 'default', '/ext/one')
    expect(store).toEqual({ default: [{ path: '/ext/one' }] })
  })

  it('is idempotent — adding the same path twice does not duplicate it', () => {
    let store = addBrowserExtension(emptyBrowserExtensionsStore(), 'default', '/ext/one')
    store = addBrowserExtension(store, 'default', '/ext/one')
    expect(store.default).toHaveLength(1)
  })

  it('removes a path and drops the key once its list is empty', () => {
    let store = addBrowserExtension(emptyBrowserExtensionsStore(), 'default', '/ext/one')
    store = removeBrowserExtension(store, 'default', '/ext/one')
    expect(store).toEqual({})
  })

  it('removing a path that keeps siblings drops only that entry', () => {
    let store = addBrowserExtension(emptyBrowserExtensionsStore(), 'default', '/ext/one')
    store = addBrowserExtension(store, 'default', '/ext/two')
    store = removeBrowserExtension(store, 'default', '/ext/one')
    expect(store).toEqual({ default: [{ path: '/ext/two' }] })
  })

  it('removing a path that is not present is a no-op returning the same reference', () => {
    const store = addBrowserExtension(emptyBrowserExtensionsStore(), 'default', '/ext/one')
    const next = removeBrowserExtension(store, 'default', '/nowhere')
    expect(next).toBe(store)
  })

  it('removing from a key that does not exist is a no-op', () => {
    const store = emptyBrowserExtensionsStore()
    const next = removeBrowserExtension(store, 'default', '/ext/one')
    expect(next).toBe(store)
  })

  it('two different partition keys are independent', () => {
    let store = addBrowserExtension(emptyBrowserExtensionsStore(), 'default', '/ext/one')
    store = addBrowserExtension(store, 'persist:profile-a', '/ext/two')
    expect(store).toEqual({
      default: [{ path: '/ext/one' }],
      'persist:profile-a': [{ path: '/ext/two' }]
    })
  })
})

describe('parseBrowserExtensionsStore (tolerant merge-path decoder)', () => {
  it('accepts a well-formed store unchanged', () => {
    const raw = { default: [{ path: '/a' }] }
    expect(parseBrowserExtensionsStore(raw)).toEqual(raw)
  })

  it('drops a malformed entry rather than throwing', () => {
    const raw = { default: [{ path: '/a' }, { path: 123 }, {}, null] }
    expect(parseBrowserExtensionsStore(raw)).toEqual({ default: [{ path: '/a' }] })
  })

  it('drops a key whose value is not an array', () => {
    const raw = { default: 'not-an-array' }
    expect(parseBrowserExtensionsStore(raw)).toEqual({})
  })

  it('dedupes a duplicated path within one key on parse', () => {
    const raw = { default: [{ path: '/a' }, { path: '/a' }] }
    expect(parseBrowserExtensionsStore(raw)).toEqual({ default: [{ path: '/a' }] })
  })

  it('returns empty for null, a non-object, or an array root', () => {
    expect(parseBrowserExtensionsStore(null)).toEqual({})
    expect(parseBrowserExtensionsStore('x')).toEqual({})
    expect(parseBrowserExtensionsStore([1, 2])).toEqual({})
  })

  it('drops an empty-string key', () => {
    const raw = { '': [{ path: '/a' }] }
    expect(parseBrowserExtensionsStore(raw)).toEqual({})
  })
})

describe('parsePersistedBrowserExtensions (strict decoder for a direct file read)', () => {
  it('accepts a well-formed store', () => {
    const raw = { default: [{ path: '/a' }] }
    expect(parsePersistedBrowserExtensions(raw)).toEqual(raw)
  })

  it('throws on a root that is not a plain object', () => {
    expect(() => parsePersistedBrowserExtensions(null)).toThrow()
    expect(() => parsePersistedBrowserExtensions('x')).toThrow()
    expect(() => parsePersistedBrowserExtensions([1, 2])).toThrow()
  })

  it('throws when a key value is not an array', () => {
    expect(() => parsePersistedBrowserExtensions({ default: 'nope' })).toThrow()
  })

  it('throws when an entry has no string path', () => {
    expect(() => parsePersistedBrowserExtensions({ default: [{ path: 5 }] })).toThrow()
    expect(() => parsePersistedBrowserExtensions({ default: [{}] })).toThrow()
  })
})

describe('allBrowserExtensionEntries', () => {
  it('flattens every key/path pair, in order', () => {
    let store = addBrowserExtension(emptyBrowserExtensionsStore(), 'default', '/a')
    store = addBrowserExtension(store, 'default', '/b')
    store = addBrowserExtension(store, 'persist:profile-1', '/c')
    expect(allBrowserExtensionEntries(store)).toEqual([
      { key: 'default', path: '/a' },
      { key: 'default', path: '/b' },
      { key: 'persist:profile-1', path: '/c' }
    ])
  })

  it('is empty for an empty store', () => {
    expect(allBrowserExtensionEntries(emptyBrowserExtensionsStore())).toEqual([])
  })
})
