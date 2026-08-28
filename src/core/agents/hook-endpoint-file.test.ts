import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hookServer } from './hook-server'
import { nodeTokenDir } from './node-token-files'
import { initPlatform, resetPlatformForTests } from '../platform'
import { fakePlatform } from '../platform-fake'
import { posixQuote } from '../../shared/ssh'

let dir = ''
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeterm-ep-'))
  resetPlatformForTests()
  initPlatform(fakePlatform({ userDataDir: dir }))
  await hookServer.start()
})
afterAll(() => {
  hookServer.stop()
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('endpoint file v2', () => {
  it('advertises the token dir and version 2, at 0600', () => {
    const p = hookServer.endpointFilePath()
    const body = fs.readFileSync(p, 'utf8')
    // Windows has no POSIX permission bits: `chmod(0o600)` only toggles the read-only ATTRIBUTE,
    // and the owner-write bit 0o600 sets clears it — so `stat` reports a generic writable mode
    // (0o666), never the exact POSIX bits. Assert the real invariant there instead.
    if (process.platform === 'win32') expect(fs.statSync(p).mode & 0o200).toBeTruthy()
    else expect(fs.statSync(p).mode & 0o777).toBe(0o600)
    // `posixQuote`d: this file is `.`-sourced by a POSIX shell, and an unquoted assignment has its
    // backslashes eaten by the shell's own escape handling — on win32 `nodeTokenDir()` is a native
    // `C:\...` path, so an unquoted line here silently mangled it before any shim ever read it.
    expect(body).toContain(`NODETERM_NODE_TOKEN_DIR=${posixQuote(nodeTokenDir())}\n`)
    expect(body).toContain("NODETERM_HOOK_VERSION='2'\n")
    // Values are single-quoted (issue #351): the managed script SOURCES this file under /bin/sh,
    // so a space or shell metachar in the path/token must be quoted to source cleanly.
    expect(body).toContain(`NODETERM_NODE_TOKEN_DIR='${nodeTokenDir()}'\n`)
    expect(body).toContain("NODETERM_HOOK_VERSION='2'\n")
    // The token dir is under this run's userDataDir, not a compiled-in path.
    expect(nodeTokenDir().startsWith(dir)).toBe(true)
  })
})
