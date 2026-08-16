// The brute-force throttle on the shared mode PIN.
//
// It exists because `disable(pin)` is on the bridge, DevTools is reachable in a packaged build and
// unavoidable in the browser edition, and a 4-digit PIN is 10^4 — a console loop walks the whole
// keyspace in minutes without one. The toy-lock service has had this since it shipped, for a
// feature its own header calls "NOT security"; the child-facing lock had none.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

vi.mock('./platform', () => ({
  platform: () => ({
    handle: () => {},
    broadcast: () => {},
    userDataDir: () => os.tmpdir()
  })
}))

const { hasCredential, setCredential, verifyPin, retryAfterMs, resetRateLimitForTests } = await import(
  './shared-mode-credential'
)

let dir: string
let file: string

beforeEach(async () => {
  resetRateLimitForTests()
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-cred-'))
  file = path.join(dir, 'test.credential.json')
  await setCredential(file, '1234')
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('brute-force throttling', () => {
  it('propagates an unreadable credential instead of reporting that it is absent', async () => {
    const realAccess = fs.access
    vi.spyOn(fs, 'access').mockImplementation((async (target: any, ...args: any[]) => {
      if (String(target) === file) {
        throw Object.assign(new Error('EACCES: credential is unreadable'), { code: 'EACCES' })
      }
      return (realAccess as any)(target, ...args)
    }) as typeof fs.access)

    await expect(hasCredential(file)).rejects.toMatchObject({ code: 'EACCES' })
  })

  it('lets the first few wrong attempts through, then makes the caller wait', async () => {
    expect(retryAfterMs(file)).toBe(0)
    for (let i = 0; i < 3; i++) expect(await verifyPin(file, '0000')).toBe(false)
    expect(retryAfterMs(file), 'a backoff should now be in effect').toBeGreaterThan(0)
  })

  it('refuses the CORRECT PIN while the backoff is in effect', async () => {
    // The property that makes it a throttle rather than a hint: it does not look at the
    // credential at all while waiting, so a right guess mid-backoff is worth nothing.
    for (let i = 0; i < 4; i++) await verifyPin(file, '0000')
    expect(retryAfterMs(file)).toBeGreaterThan(0)
    expect(await verifyPin(file, '1234')).toBe(false)
  })

  it('backs off exponentially rather than by a fixed step', async () => {
    for (let i = 0; i < 4; i++) await verifyPin(file, '0000')
    const afterFour = retryAfterMs(file)
    vi.setSystemTime(Date.now() + afterFour + 10)
    await verifyPin(file, '0000')
    const afterFive = retryAfterMs(file)
    expect(afterFive).toBeGreaterThan(afterFour)
    vi.useRealTimers()
  })

  it('clears the counter on a correct PIN', async () => {
    for (let i = 0; i < 2; i++) await verifyPin(file, '0000')
    expect(await verifyPin(file, '1234')).toBe(true)
    expect(retryAfterMs(file), 'a success resets the streak').toBe(0)
  })

  it('throttles each credential separately', async () => {
    // School mode and Kids mode share this module but not their credentials. One being locked out
    // must not lock the other, or an adult loses access to a mode they were not even attacking.
    const other = path.join(dir, 'other.credential.json')
    await setCredential(other, '5678')
    for (let i = 0; i < 4; i++) await verifyPin(file, '0000')
    expect(retryAfterMs(file)).toBeGreaterThan(0)
    expect(retryAfterMs(other), 'the other credential is untouched').toBe(0)
    expect(await verifyPin(other, '5678')).toBe(true)
  })
})
