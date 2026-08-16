import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Guard for our local node-pty fd-leak patch (microsoft/node-pty#950).
 *
 * node-pty 1.1.0's darwin `pty_posix_spawn` leaks one ptmx device per SUCCESSFUL
 * spawn (off-by-one in the low-fd cleanup) and master+slave on every FAILED one.
 * On this app's spawn churn that exhausts `kern.tty.ptmx_max` within hours.
 * scripts/patch-node-pty.mjs rewrites node_modules/node-pty/src/unix/pty.cc
 * before electron-rebuild compiles it.
 *
 * This test does NOT measure descriptors (that is environment-dependent); it
 * asserts the patch is present in the sources the native module is built from,
 * so a node-pty upgrade that silently drops it fails loudly here.
 */
const PTY_CC = path.resolve(__dirname, '../../node_modules/node-pty/src/unix/pty.cc')
const CONPTY_CC = path.resolve(__dirname, '../../node_modules/node-pty/src/win/conpty.cc')
const NODE_PTY_PACKAGE = path.resolve(__dirname, '../../node_modules/node-pty/package.json')
/** Must stay in sync with PATCH_MARKER in scripts/patch-node-pty.mjs. */
const PATCH_MARKER = 'NODETERM-PATCH(node-pty#950)'
const WINDOWS_CONPTY_PATCH_MARKER = 'NODETERM-PATCH(node-pty-conpty-exact-close)'

const HOWTO =
  'Run `node scripts/patch-node-pty.mjs && npm run rebuild`. ' +
  'If node-pty was upgraded, check https://github.com/microsoft/node-pty/issues/950 — ' +
  'if the fix landed upstream, delete scripts/patch-node-pty.mjs, its postinstall/rebuild ' +
  'wiring and this test; otherwise re-derive the anchors in the script.'

describe('node-pty fd-leak patch (microsoft/node-pty#950)', () => {
  const exists = fs.existsSync(PTY_CC)
  const source = exists ? fs.readFileSync(PTY_CC, 'utf8') : ''

  it.skipIf(!exists)('is applied to node_modules/node-pty/src/unix/pty.cc', () => {
    expect(source.includes(PATCH_MARKER), `node-pty fd-leak patch is MISSING. ${HOWTO}`).toBe(true)
  })

  it.skipIf(!exists)('closes the slave and the master on the failure path', () => {
    // The parent must drop its slave copy after posix_spawn, and the master too
    // when the spawn failed.
    expect(source).toContain('close(slave);\n  if (*err != 0) {\n    close(*master);')
  })

  it.skipIf(!exists)('no longer contains the off-by-one low-fd cleanup loop', () => {
    expect(
      source.includes('for (; count > 0; count--) {'),
      `Upstream's off-by-one low_fds cleanup is back — one ptmx device leaks per successful ` +
        `spawn. ${HOWTO}`
    ).toBe(false)
    expect(source).toContain('size_t opened = count < 3 ? count + 1 : 3;')
  })
})

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
