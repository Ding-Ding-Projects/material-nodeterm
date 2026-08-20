import { describe, it, expect, vi } from 'vitest'
import { E_UNSUPPORTED } from '@shared/rpc'
import { buildStubApi } from '../bridge/stubs'
import {
  buildTransferHandoff,
  canOfferTransfer,
  transferFailureBody,
  TRANSFER_FAILED_BODY,
  TRANSFER_UNSUPPORTED_BODY
} from './transferGates'

describe('canOfferTransfer', () => {
  const live = { agentId: 'claude' as const, sessionId: 'sess-1' }

  it('offers the transfer when a capable agent has a live session and a handoff builder', () => {
    expect(canOfferTransfer({ ...live, handoffSupported: true })).toBe(true)
  })

  it('hides it where nothing can build the handoff file (the Server Edition defect)', () => {
    // The exact shape the browser build satisfied before this gate existed: a capable agent with a
    // live session id, on a bridge whose `handoff.build` only rejects. The item used to render,
    // enabled, and do nothing at all when clicked.
    expect(canOfferTransfer({ ...live, handoffSupported: false })).toBe(false)
  })

  it('reads that capability from the shared bridge stub, not a local constant', () => {
    const stub = buildStubApi()
    expect(stub.handoff.supported).toBe(false)
    expect(canOfferTransfer({ ...live, handoffSupported: stub.handoff.supported })).toBe(false)
  })

  it('keeps the pre-existing gate: agent capability and a live session id', () => {
    expect(canOfferTransfer({ ...live, agentId: undefined, handoffSupported: true })).toBe(false)
    // opencode is not in TRANSFER_SOURCE_CAPABLE.
    expect(canOfferTransfer({ ...live, agentId: 'opencode', handoffSupported: true })).toBe(false)
    expect(canOfferTransfer({ ...live, sessionId: undefined, handoffSupported: true })).toBe(false)
    expect(canOfferTransfer({ ...live, sessionId: '', handoffSupported: true })).toBe(false)
  })
})

describe('buildTransferHandoff', () => {
  const ok = { filePath: '/repo/.nodeterm/handoff-term_1-2026-08-20T00-00-00-000Z.md' }

  it('passes a successful build through untouched', async () => {
    await expect(buildTransferHandoff(async () => ok)).resolves.toEqual(ok)
  })

  it('passes a resolved { error } through untouched', async () => {
    await expect(buildTransferHandoff(async () => ({ error: 'no transcript' }))).resolves.toEqual({
      error: 'no transcript'
    })
  })

  it('turns the bridge stub rejection into a resolved { error }, so the caller notifies', async () => {
    const stub = buildStubApi()
    // The raw call is what the canvas used to await: it REJECTS, so `'error' in res` never ran and
    // the failure escaped a void-ed promise with no catch — the user saw nothing at all.
    await expect(stub.handoff.build('s', 'claude', 'n', '/repo')).rejects.toMatchObject({
      code: E_UNSUPPORTED
    })

    const res = await buildTransferHandoff(() => stub.handoff.build('s', 'claude', 'n', '/repo'))
    expect(res).toEqual({ error: TRANSFER_UNSUPPORTED_BODY })
    // What the caller's error toast will read.
    expect('error' in res && res.error).toContain('not available in this edition')
  })

  it('never rejects, whatever the build throws', async () => {
    const thrown = [
      Object.assign(new Error('refused'), { code: E_UNSUPPORTED }),
      new Error('EPIPE'),
      'a bare string',
      undefined
    ]
    for (const err of thrown) {
      const build = vi.fn(() => Promise.reject(err))
      await expect(buildTransferHandoff(build)).resolves.toHaveProperty('error')
      expect(build).toHaveBeenCalledOnce()
    }
  })
})

describe('transferFailureBody', () => {
  it('reports the edition limitation only for a refusal', () => {
    expect(transferFailureBody(Object.assign(new Error('x'), { code: E_UNSUPPORTED }))).toBe(
      TRANSFER_UNSUPPORTED_BODY
    )
  })

  it('keeps a real desktop failure honest instead of blaming the edition', () => {
    expect(transferFailureBody(new Error('ENOSPC: no space left on device'))).toBe(
      'ENOSPC: no space left on device'
    )
    expect(transferFailureBody(new Error('   '))).toBe(TRANSFER_FAILED_BODY)
    expect(transferFailureBody(null)).toBe(TRANSFER_FAILED_BODY)
  })
})
