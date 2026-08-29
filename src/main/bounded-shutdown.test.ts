import { describe, expect, it } from 'vitest'
import { settleShutdownWithin } from './bounded-shutdown'

describe('bounded shutdown steps', () => {
  it('reports a completed step', async () => {
    await expect(settleShutdownWithin(Promise.resolve(), 100)).resolves.toBe('completed')
  })

  it('reports a rejected step without keeping the app alive', async () => {
    await expect(settleShutdownWithin(Promise.reject(new Error('native shutdown failed')), 100)).resolves.toBe('rejected')
  })

  it('reports a hanging step as timed out', async () => {
    await expect(settleShutdownWithin(new Promise(() => undefined), 5)).resolves.toBe('timed-out')
  })
})
