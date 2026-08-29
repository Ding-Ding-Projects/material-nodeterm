// Proves the ollama:status IPC handler actually reaches the fixed classification — a real refused
// TCP connection and a real OllamaClient, with only the install-evidence check swapped out so the
// verdict is deterministic instead of depending on whether Ollama happens to be installed on the
// machine running the suite (detectOllamaInstalled itself is covered directly, against a fake
// filesystem, in installation.test.ts). A mock at the client/fetch layer would only prove the
// wiring code typechecks, not that a genuine "connection refused" still resolves to a real health
// value end-to-end through the registered handler.

import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { registerOllamaIpc } from './register-ipc'
import type { CorePlatform } from '../platform'
import type { OllamaCatalogStore } from './catalog-store'
import type { FitEvaluation } from '../../shared/ollama'

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

function fakePlatform(userDataDir: string): CorePlatform {
  return {
    userDataDir,
    appVersion: '0.0.0-test',
    isPackaged: false,
    handle: () => {},
    on: () => {},
    handleWithSender: () => {},
    onWithSender: () => {},
    sendTo: () => {},
    broadcast: () => {},
    clientIds: () => [],
    openExternal: async () => {}
  }
}

describe('registerOllamaIpc — ollama:status', () => {
  let port: number
  let dirs: string[] = []

  beforeAll(async () => {
    port = await unusedPort()
  })

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  function harness(
    checkInstalled: () => { found: boolean; via: 'path' | 'known-location' | null },
    catalog?: OllamaCatalogStore
  ) {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const dir = mkdtempSync(join(tmpdir(), 'ollama-ipc-'))
    dirs.push(dir)
    const platform = fakePlatform(dir)
    platform.handle = (channel, fn) => handlers.set(channel, fn as (...args: unknown[]) => unknown)
    process.env.OLLAMA_HOST = `http://127.0.0.1:${port}`
    registerOllamaIpc(platform, { checkInstalled, catalog })
    delete process.env.OLLAMA_HOST
    return handlers
  }

  it('a real refused connection reports "not-installed" when no evidence of the binary is found', async () => {
    const handlers = harness(() => ({ found: false, via: null }))
    const status = await handlers.get('ollama:status')!()
    expect((status as { health: string }).health).toBe('not-installed')
    expect((status as { detail: string | null }).detail).toBeTruthy()
  })

  it('the SAME real refused connection reports "stopped" once real evidence of the binary is found — the only thing that changed is checkInstalled, exactly as classifyOllamaHealth documents', async () => {
    const handlers = harness(() => ({ found: true, via: 'known-location' }))
    const status = await handlers.get('ollama:status')!()
    expect((status as { health: string }).health).toBe('stopped')
  })

  it('never claims "ok" against a port with nothing listening, and never the misleading "unhealthy" the old text-matching classifier produced for a connection Ollama never actually answered on', async () => {
    const handlers = harness(() => ({ found: false, via: null }))
    const status = await handlers.get('ollama:status')!()
    expect((status as { health: string }).health).not.toBe('ok')
    expect((status as { health: string }).health).not.toBe('unhealthy')
  })

  // Ollama is unreachable in this harness, so nothing is installed as far as the handler can tell.
  // That used to force every store row to "Unknown"; the catalog's published size is a real fact
  // about the model and is now allowed to feed the same evaluator, with its precision named.
  describe('ollama:fit for a model that is not installed', () => {
    const withCatalog = (size: { sizeBytes: number; exact: boolean } | null): OllamaCatalogStore =>
      ({ publishedSize: async () => size }) as unknown as OllamaCatalogStore

    it('reaches a real verdict from the published size and says where that size came from', async () => {
      const handlers = harness(() => ({ found: true, via: 'path' }), withCatalog({ sizeBytes: 1_300_000_000, exact: false }))
      const fit = (await handlers.get('ollama:fit')!(['llama3.2:1b'])) as Record<string, FitEvaluation>
      expect(fit['llama3.2:1b'].verdict).not.toBe('unknown')
      expect(fit['llama3.2:1b'].evidence[0]).toContain('is not installed')
      expect(fit['llama3.2:1b'].evidence[0]).toContain('approximate')
    })

    it('stays "unknown" — never a guess from the name — when the catalog has no size for it', async () => {
      const handlers = harness(() => ({ found: true, via: 'path' }), withCatalog(null))
      const fit = (await handlers.get('ollama:fit')!(['llama3.2:1b'])) as Record<string, FitEvaluation>
      expect(fit['llama3.2:1b'].verdict).toBe('unknown')
    })
  })
})
