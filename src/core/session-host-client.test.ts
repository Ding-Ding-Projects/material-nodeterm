// The three poke guys that made every persistent terminal on Windows silently non-persistent.
//
// They stacked, and each hid the next:
//
//   1. `finish(true)` in tryConnectOnce stripped ALL 'data' listeners — including the one
//      `attachSocket` had installed one line earlier. The connection then looked perfect and was
//      DEAF: every frame the host sent afterwards went unread.
//   2. `request()` had no deadline, so a deaf socket meant the promise never settled. The caller
//      awaits it inside a try/catch, and a catch cannot help a promise that never settles.
//   3. The session-host branch asked for `bash` — on the platform selected BECAUSE it has no
//      tmux. Covered in pty-session-shell.test.ts, where that decision lives.
//
// SOURCE-LEVEL, and the reason is worth stating rather than assumed. The behaviour here was
// proved end-to-end against a real app and a real host: `pty.create` went from 10,017 ms
// (my own timeout, i.e. never answering) to 66 ms, and the host's own `listSessions` then listed
// the session by name — which is the only check that distinguishes "reports persistent" from "is
// persistent", and the one that caught this reporting a success twice while the host held nothing.
//
// Reproducing that in-process needs a real socket server, and `net` does not behave under this
// suite's environment the way it does in the app. A test that cannot run is worse than one that
// admits its shape: these assertions pin the exact lines whose absence caused the outage, and
// each was verified by reverting it and watching this file go red.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(join(__dirname, 'session-host-client.ts'), 'utf8')

describe('the socket can still hear the host after a successful handshake', () => {
  it('only strips data listeners on FAILURE', () => {
    // The whole outage in one line. `finish` ran `removeAllListeners('data')` unconditionally,
    // one statement after `attachSocket(socket)` installed the reader.
    const finish = /const finish = \(ok: boolean\): void => \{[\s\S]*?\n      \}/.exec(SRC)?.[0] ?? ''
    expect(finish, 'finish() not found — this guard is checking nothing').toContain('removeAllListeners')
    const strip = finish.indexOf("removeAllListeners('data')")
    const guard = finish.indexOf('if (!ok)')
    expect(guard, 'the failure guard must exist').toBeGreaterThanOrEqual(0)
    expect(strip, 'the strip must sit INSIDE the !ok branch').toBeGreaterThan(guard)
  })

  it('installs the real reader before finishing', () => {
    // Ordering matters only because the strip is now conditional; if someone reverses these the
    // reader is installed on a socket that is about to be destroyed.
    expect(SRC.indexOf('this.attachSocket(socket)')).toBeLessThan(SRC.indexOf('finish(true)'))
  })
})

describe('no request can wait forever', () => {
  it('every request carries a deadline that REJECTS', () => {
    const req = /private async request<T>[\s\S]*?\n  \}/.exec(SRC)?.[0] ?? ''
    expect(req, 'request() not found').toContain('REQUEST_TIMEOUT_MS')
    expect(req, 'the deadline must reject, not resolve').toMatch(/setTimeout\([\s\S]*?reject\(/)
  })

  it('the deadline is cleared on both settle paths, or it leaks a timer per request', () => {
    const req = /private async request<T>[\s\S]*?\n  \}/.exec(SRC)?.[0] ?? ''
    expect((req.match(/clearTimeout\(timer\)/g) || []).length).toBeGreaterThanOrEqual(3)
  })

  it('is long enough for a cold shell spawn', () => {
    // Killing a slow-but-working attach would turn a slow terminal into a broken one — the
    // opposite mistake, and harder to notice because it looks like flakiness.
    const ms = Number(/const REQUEST_TIMEOUT_MS = ([\d_]+)/.exec(SRC)?.[1]?.replace(/_/g, ''))
    expect(ms).toBeGreaterThanOrEqual(5_000)
    expect(ms).toBeLessThanOrEqual(30_000)
  })
})
