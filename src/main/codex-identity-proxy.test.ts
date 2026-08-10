import { execFile } from 'child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { promisify } from 'util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCodexLauncher, validCodexIdentity } from '../core/codex-identity-proxy'

const run = promisify(execFile)

describe('NodeTerm Codex remote launcher', () => {
  const oldHome = process.env.HOME

  afterEach(() => {
    vi.unstubAllEnvs()
    if (oldHome === undefined) delete process.env.HOME
    else process.env.HOME = oldHome
  })

  it('keeps two parallel node identities isolated on one shared remote endpoint', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-launcher-'))
    const bin = path.join(root, 'bin')
    const fakeCodex = path.join(bin, 'codex')
    const outA = path.join(root, 'a.json')
    const outB = path.join(root, 'b.json')
    await run('/bin/mkdir', ['-p', bin])
    writeFileSync(
      fakeCodex,
      '#!/bin/sh\nprintf \'[\' > "$CAPTURE"\nfirst=1\nfor arg in "$@"; do [ "$first" = 1 ] || printf \',\' >> "$CAPTURE"; first=0; node -e \'process.stdout.write(JSON.stringify(process.argv[1]))\' -- "$arg" >> "$CAPTURE"; done\nprintf \']\' >> "$CAPTURE"\n',
      { mode: 0o700 }
    )
    vi.stubEnv('HOME', root)
    const launcher = installCodexLauncher()
    const base = { PATH: `${bin}:${process.env.PATH ?? ''}`, NODETERM_CANVAS_CONTROL: '1' }
    await Promise.all([
      run(launcher, ['resume', 'thread-a'], { env: {
        ...process.env, ...base, CAPTURE: outA,
        NODETERM_NODE_ID: 'node-a', NODETERM_HOOK_ENDPOINT: '/isolated/node-a/hook.env'
      }}),
      run(launcher, ['resume', 'thread-b'], { env: {
        ...process.env, ...base, CAPTURE: outB,
        NODETERM_NODE_ID: 'node-b', NODETERM_HOOK_ENDPOINT: '/isolated/node-b/hook.env'
      }})
    ])
    const argsA = JSON.parse(readFileSync(outA, 'utf8'))
    const argsB = JSON.parse(readFileSync(outB, 'utf8'))
    expect(argsA).toEqual(['--remote', 'unix://', 'resume', 'thread-a'])
    expect(argsB).toEqual(['--remote', 'unix://', 'resume', 'thread-b'])
    expect(argsA.slice(0, 2)).toEqual(argsB.slice(0, 2))
    const maps = path.join(root, '.nodeterm', 'codex-thread-nodes')
    expect(readFileSync(path.join(maps, 'thread-a'), 'utf8')).toBe(
      'nodeId=node-a\nendpoint=/isolated/node-a/hook.env\n'
    )
    expect(readFileSync(path.join(maps, 'thread-b'), 'utf8')).toBe(
      'nodeId=node-b\nendpoint=/isolated/node-b/hook.env\n'
    )
  })

  it('fails closed before launch for a missing or invalid resume-thread mapping key', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'nodeterm-codex-launcher-invalid-'))
    const bin = path.join(root, 'bin')
    await run('/bin/mkdir', ['-p', bin])
    writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nexit 99\n', { mode: 0o700 })
    vi.stubEnv('HOME', root)
    const launcher = installCodexLauncher()
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      NODETERM_CANVAS_CONTROL: '1',
      NODETERM_NODE_ID: 'node-a',
      NODETERM_HOOK_ENDPOINT: '/isolated/node-a/hook.env'
    }
    await expect(run(launcher, ['resume'], { env })).rejects.toMatchObject({ code: 64 })
    await expect(run(launcher, ['resume', '../other'], { env })).rejects.toMatchObject({ code: 64 })
  })

  it.each([
    ['', '/isolated/hook.env'],
    ['../invalid', '/isolated/hook.env'],
    ['node-a', 'relative.env'],
    ['node-a', '/isolated/evil"value']
  ])('fails closed for invalid identity node=%s endpoint=%s', (nodeId, endpoint) => {
    expect(validCodexIdentity(nodeId, endpoint)).toBe(false)
  })
})
