import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hookServer } from './hook-server'
import { nodeTokenDir } from './node-token-files'
import { initPlatform, resetPlatformForTests } from '../platform'
import { fakePlatform } from '../platform-fake'

let dir = ''
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-ep-'))
  resetPlatformForTests()
  initPlatform(fakePlatform({ userDataDir: dir }))
  await hookServer.start()
})
afterAll(() => {
  hookServer.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('endpoint file v2', () => {
  it('advertises the token dir and version 2, at 0600', () => {
    const p = hookServer.endpointFilePath()
    const body = fs.readFileSync(p, 'utf8')
    // NTFS has no POSIX owner/group/other bits — see node-auth-secret.test.ts's win32 note.
    if (process.platform !== 'win32') expect(fs.statSync(p).mode & 0o777).toBe(0o600)
    // Single-quoted (POSIX `VAR='value'`) — see hook-server.ts's writeEndpointFile note: an
    // unquoted assignment has sh strip every backslash when the managed script later sources
    // this file, corrupting a win32 token dir path.
    expect(body).toContain(`NODETERM_NODE_TOKEN_DIR='${nodeTokenDir()}'\n`)
    expect(body).toContain('NODETERM_HOOK_VERSION=2\n')
    // The token dir is under this run's userDataDir, not a compiled-in path.
    expect(nodeTokenDir().startsWith(dir)).toBe(true)
  })
})
