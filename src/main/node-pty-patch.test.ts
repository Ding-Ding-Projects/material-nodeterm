import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Guard for our local node-pty Windows ConPTY patch.
 *
 * node-pty 1.1.0 deletes its native `pty_baton` as soon as the shell process handle signals,
 * without closing the HPCON the baton owns. A taskkill-first teardown then leaves a host-parented
 * conhost alive until the whole Node process exits, and `kill(id)` reports nothing.
 * scripts/patch-node-pty.mjs rewrites node_modules/node-pty/src/win/conpty.cc before
 * electron-rebuild compiles it: baton access is serialized, the exact HPCON is closed before
 * deletion, and `kill(id)` returns positive proof.
 *
 * (The script's darwin ptmx-leak patch — microsoft/node-pty#950 — was deleted with the macOS
 * desktop; the leak lives in a darwin-only compilation unit no Windows or Linux build compiles.)
 *
 * This test does NOT measure handles (that is environment-dependent); it asserts the patch is
 * present in the sources the native module is built from, so a node-pty upgrade that silently
 * drops it fails loudly here.
 */
const CONPTY_CC = path.resolve(__dirname, '../../node_modules/node-pty/src/win/conpty.cc')
const NODE_PTY_PACKAGE = path.resolve(__dirname, '../../node_modules/node-pty/package.json')
/** Must stay in sync with WINDOWS_CONPTY_PATCH_MARKER in scripts/patch-node-pty.mjs. */
const WINDOWS_CONPTY_PATCH_MARKER = 'NODETERM-PATCH(node-pty-conpty-exact-close)'

describe('node-pty exact Windows ConPTY close patch', () => {
  const exists = fs.existsSync(CONPTY_CC) && fs.existsSync(NODE_PTY_PACKAGE)
  const source = exists ? fs.readFileSync(CONPTY_CC, 'utf8') : ''
  const packageVersion = exists
    ? (JSON.parse(fs.readFileSync(NODE_PTY_PACKAGE, 'utf8')) as { version?: unknown }).version
    : undefined

  it.skipIf(!exists)('stays pinned to the reviewed node-pty native source version', () => {
    expect(packageVersion).toBe('1.1.0')
    expect(source).toContain(WINDOWS_CONPTY_PATCH_MARKER)
  })

  it.skipIf(!exists)('closes the exact HPCON before deleting its shell-exit baton', () => {
    const closeIndex = source.indexOf('baton->closeExactPseudoConsole();')
    const removeIndex = source.indexOf('remove_pty_baton(lock, baton->id)')
    expect(closeIndex).toBeGreaterThan(0)
    expect(removeIndex).toBeGreaterThan(closeIndex)
    expect(source).toContain('std::lock_guard<std::mutex> lock(g_ptyHandlesMutex);')
  })

  it.skipIf(!exists)('returns positive proof instead of the stock void/no-op kill result', () => {
    expect(source).toContain('closed = handle->closeExactPseudoConsole();')
    expect(source).toContain('return Napi::Boolean::New(env, closed);')
  })
})
