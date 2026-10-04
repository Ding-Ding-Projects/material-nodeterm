import { afterEach, describe, expect, it, vi } from 'vitest'
import { pendingFromStatus, runPendingUpdate, RELEASES_URL, usePendingUpdate } from './pendingUpdate'

afterEach(() => usePendingUpdate.getState().setPending(null))

describe('pendingFromStatus', () => {
  it('mirrors the three states that still owe the user an install action', () => {
    expect(pendingFromStatus({ kind: 'downloaded', version: '1.2.3' })).toEqual({
      kind: 'downloaded',
      version: '1.2.3'
    })
    expect(pendingFromStatus({ kind: 'manual' })).toEqual({ kind: 'manual' })
    expect(pendingFromStatus({ kind: 'required', minSupported: null })).toEqual({
      kind: 'required',
      minSupported: null
    })
  })

  it('leaves the button alone for a dismissed or transient card', () => {
    for (const kind of ['idle', 'checking', 'available', 'upToDate', 'noChannel', 'error']) {
      expect(pendingFromStatus({ kind })).toBeUndefined()
    }
  })
})

describe('runPendingUpdate', () => {
  it('restarts into a staged update, opens the download page, or checks again', () => {
    const api = { restart: vi.fn(), check: vi.fn() }
    const open = vi.fn()
    runPendingUpdate({ kind: 'downloaded', version: '1.2.3' }, api, open)
    expect(api.restart).toHaveBeenCalledOnce()
    runPendingUpdate({ kind: 'manual', version: '1.2.3' }, api, open)
    expect(open).toHaveBeenCalledWith(RELEASES_URL)
    runPendingUpdate({ kind: 'required', minSupported: '1.0.0' }, api, open)
    expect(api.check).toHaveBeenCalledOnce()
  })
})
