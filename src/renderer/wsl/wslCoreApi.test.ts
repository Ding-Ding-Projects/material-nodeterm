import { describe, expect, it } from 'vitest'
import { createUnsupportedWslApi, resolveWslApi, WSL_UNSUPPORTED_ERROR } from './wslCoreApi'

describe('resolveWslApi', () => {
  it('returns the injected bridge when present', async () => {
    const api = resolveWslApi({
      nodeTerminal: {
        wsl: {
          list: async () => [{ name: 'Ubuntu', state: 'running', ownedByApp: true }],
          catalogue: async () => [],
          create: async () => ({ ok: true, name: 'x' }),
          cancelCreate: async () => false,
          onCreateProgress: () => () => {},
          sleep: async () => ({ ok: true }),
          wake: async () => ({ ok: true }),
          delete: async () => ({ ok: true })
        }
      }
    })
    expect(await api.list()).toEqual([{ name: 'Ubuntu', state: 'running', ownedByApp: true }])
  })

  it('degrades to the unsupported stub when no bridge is present', async () => {
    const api = resolveWslApi({})
    expect(await api.list()).toEqual([])
    expect(await api.catalogue()).toEqual([])
    expect(await api.sleep('anything')).toEqual({ ok: false, error: WSL_UNSUPPORTED_ERROR })
    expect(await api.wake('anything')).toEqual({ ok: false, error: WSL_UNSUPPORTED_ERROR })
    expect(await api.delete('anything')).toEqual({ ok: false, error: WSL_UNSUPPORTED_ERROR })
    expect(await api.create({ operationId: 'test', catalogueId: 'x', name: 'y' })).toEqual({
      ok: false,
      error: WSL_UNSUPPORTED_ERROR
    })
  })
})

describe('createUnsupportedWslApi', () => {
  it('never throws and never fabricates success', async () => {
    const api = createUnsupportedWslApi()
    await expect(api.list()).resolves.toEqual([])
    await expect(api.delete('docker-desktop')).resolves.toEqual({
      ok: false,
      error: WSL_UNSUPPORTED_ERROR
    })
  })
})
