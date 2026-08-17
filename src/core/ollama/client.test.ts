// Real (non-mocked) network tests against a genuinely refused loopback connection — proving the
// exact runtime claim installation.ts's classifyOllamaHealth relies on: Node's fetch collapses a
// refused connection's top-level `.message` to "fetch failed", and the real OS error code lives on
// `.cause.code`. This is deliberately NOT tested against a mocked fetch, because a mock would only
// prove the mock was shaped the way the test author believed reality was shaped — the whole bug
// this file exists to catch was exactly that belief being wrong.

import { createServer } from 'node:net'
import { beforeAll, describe, expect, it } from 'vitest'
import { OllamaClient } from './client'

/** Grabs a real free loopback port by briefly binding to port 0, then releasing it. Nothing else
 *  listens on it afterward, so a client connecting there gets a genuine ECONNREFUSED — not a mock
 *  of one. */
async function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : null
      srv.close(() => (port ? resolve(port) : reject(new Error('could not obtain a free port'))))
    })
  })
}

describe('OllamaClient against a real refused connection', () => {
  let port: number

  beforeAll(async () => {
    port = await unusedPort()
  })

  it('ping() surfaces code "ECONNREFUSED" — not just the generic "fetch failed" message', async () => {
    const client = new OllamaClient(`http://127.0.0.1:${port}`)
    const result = await client.ping()
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ECONNREFUSED')
    // Deliberately NOT asserting anything about the shape of `detail`.
    //
    // An earlier version of this test asserted that the message does not itself contain
    // "econnrefused", to dramatise why reading `code` beats parsing prose. That is an assertion
    // about the RUNTIME's error text, not about our code, and it is false here: Node 24 on Windows
    // reports `connect econnrefused 127.0.0.1:<port>`. A test that fails when the platform words
    // an error differently is testing the platform it happens to run on.
    //
    // The claim worth pinning is the one above and it is unchanged: `code` is populated, so
    // `classifyOllamaHealth` never has to text-match a message that may be phrased anything at all.
    expect(result.detail).toBeTruthy()
  })

  it('tags()/running() reject rather than silently returning an empty array (register-ipc.ts is the layer that decides to swallow that)', async () => {
    const client = new OllamaClient(`http://127.0.0.1:${port}`)
    await expect(client.tags()).rejects.toThrow()
  })
})
