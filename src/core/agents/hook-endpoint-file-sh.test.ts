import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { hookServer } from './hook-server'
import { nodeTokenDir } from './node-token-files'
import { initPlatform, resetPlatformForTests } from '../platform'
import { fakePlatform } from '../platform-fake'

// A Linux Server Edition data directory can contain spaces. The managed hook script SOURCES the
// endpoint file (`. "$file"`) under /bin/sh, so an unquoted assignment would split the path and
// exit 127. This test proves the file sources cleanly under a REAL /bin/sh. A source-text assertion
// can pass while real sh fails, which is exactly the class of bug this repo insists we prove against
// a real reader.
let spaced = ''
beforeAll(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-ep-sh-'))
  // A subdir with a space in its name, matching a valid Linux server data layout.
  spaced = path.join(root, 'server data', 'node-terminal')
  fs.mkdirSync(spaced, { recursive: true })
  resetPlatformForTests()
  initPlatform(fakePlatform({ userDataDir: spaced }))
  await hookServer.start()
})
afterAll(() => {
  hookServer.stop()
})

describe('endpoint file sources cleanly under real /bin/sh with a spaced path', () => {
  it.skipIf(process.platform !== 'linux')('preserves the exact NODETERM_NODE_TOKEN_DIR path, space intact', () => {
    const p = hookServer.endpointFilePath()
    // Sanity: the writer really is exercising a spaced path this run.
    expect(nodeTokenDir()).toContain(' ')
    expect(nodeTokenDir().startsWith(spaced)).toBe(true)

    const r = spawnSync(
      '/bin/sh',
      ['-c', `. "$1" && printf %s "$NODETERM_NODE_TOKEN_DIR"`, 'sh', p],
      { encoding: 'utf8' }
    )
    // (1) sh must source the file without error (unquoted → exit 127).
    expect(r.status).toBe(0)
    // (2) and the path must arrive with its space intact, byte for byte.
    expect(r.stdout).toBe(nodeTokenDir())
  })

  it('the shared TS parser reads the REAL writer output identically to sh', async () => {
    const { parseEndpointEnv } = await import('./hook-endpoint-parse')
    const env = parseEndpointEnv(fs.readFileSync(hookServer.endpointFilePath(), 'utf8'))
    expect(env.NODETERM_NODE_TOKEN_DIR).toBe(nodeTokenDir())
    expect(env.NODETERM_HOOK_TOKEN).toBe(hookServer.getToken())
    expect(Number(env.NODETERM_HOOK_PORT)).toBe(hookServer.getPort())
  })
})
