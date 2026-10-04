// The desktop shell's half of the context meter's mount-time rehydration (upstream issue #813).
//
// `core/context-ensure.test.ts` pins the ROUTING with injected deps. What it cannot reach is this
// shell's `ensureRemote` closure, which is inline in `index.ts` over `ptyManager`,
// `sshProjectManager` and `remoteContextTail` — so its three load-bearing properties are pinned at
// source level, the same way `remote-end-wiring.test.ts` and `codex-identity-record-wiring.test.ts`
// pin theirs. Each of them fails SILENTLY if it regresses: a missing jail reads a file the host
// named, a fall-through meters the wrong machine, and a handler nobody registers simply leaves the
// meter blank exactly as before.
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import path from 'path'

const SERVER_DIR = path.join(__dirname, '..', 'server')
const SRC = readFileSync(path.join(__dirname, 'index.ts'), 'utf8').replace(/\r\n/g, '\n')
const SERVER = readFileSync(path.join(SERVER_DIR, 'index.ts'), 'utf8').replace(/\r\n/g, '\n')

/** The `ensureRemote: async (…) => { … }` body inside the `registerContextEnsureIpc({ … })` call. */
const ensureRemoteBody = (): string => {
  const start = SRC.indexOf(
    'ensureRemote: async ({ sessionId, cwd, accountId, agentId, nodeId, remote })'
  )
  expect(start, 'ensureRemote closure not found in src/main/index.ts').toBeGreaterThan(-1)
  const end = SRC.indexOf('\n  })', start)
  expect(end, 'end of the registerContextEnsureIpc call not found').toBeGreaterThan(start)
  return SRC.slice(start, end)
}

describe('main wires the context-meter rehydration', () => {
  it('registers the core handler at all', () => {
    // A handler nobody registers is the whole bug: the renderer casts and nothing receives it.
    expect(SRC).toContain('registerContextEnsureIpc({')
    // …and exactly one: a second, inline listener is how the two copies drifted apart before.
    expect(SRC).not.toMatch(/\.on\(\s*IPC\.contextEnsure/)
  })

  it('admits located paths through the same local jail as hook-fed ones', () => {
    const body = SRC.slice(SRC.indexOf('registerContextEnsureIpc({'))
    const admit = body.slice(body.indexOf('admitLocalPath:'), body.indexOf('onTracked:'))
    expect(admit).toContain('isSafeLocalTranscriptPath(abs, homedir(), app.getPath(\'userData\'), codexHome())')
  })

  it('routes each agent to its own tail, and gives grok none', () => {
    const body = SRC.slice(SRC.indexOf('registerContextEnsureIpc({'))
    expect(body).toContain('return codexContextTail')
    expect(body).toContain('return geminiContextTail')
    // grok's meter reads a hook-derived signals.json path; there is nothing to rehydrate from, so
    // the switch must fall through to `undefined` rather than adopt claude's tail.
    expect(body.slice(0, body.indexOf('ensureRemote'))).not.toContain('grok')
  })
})

describe('the remote leg keeps the jail and never falls through', () => {
  it('resolves through `remoteTranscriptRefFor`, the one jailed locator', () => {
    const body = ensureRemoteBody()
    expect(body).toContain('await remoteTranscriptRefFor(sessionId, cwd, accountId, nodeId)')
    // Calling the locator directly would skip `isSafeRemoteTranscriptPath` — a located path is
    // attacker-influenced input (it crosses a machine boundary before we read it). Matched as a
    // CALL, since the closure's comments name the locator to explain the boundary.
    expect(body).not.toContain('locateRemoteTranscriptCommand(')
  })

  it('`remoteTranscriptRefFor` still jails what the host answered', () => {
    // The property the test above delegates to. Pinned here so removing the jail cannot leave this
    // file green while the ensure path quietly starts reading whatever the host named.
    const fn = SRC.slice(SRC.indexOf('const remoteTranscriptRefFor = async ('))
    const body = fn.slice(0, fn.indexOf('\n  }\n'))
    expect(body).toContain('isSafeRemoteTranscriptPath(located, remoteHome)')
  })

  it('answers `null` only when neither claim of remoteness holds', () => {
    const body = ensureRemoteBody()
    // `null` is core's signal to take the LOCAL path. Returning it for anything else (a failed ssh
    // call, an unresolved home, a pty that is not up yet) sends a remote session to this machine's
    // disk, where claude's cwd fallback happily meters an unrelated local session under the remote
    // node's id. The renderer's claim is OR-ed in because a mount races pty creation.
    const nulls = body.split('\n').filter((l) => /return null/.test(l))
    expect(nulls.length).toBe(1)
    expect(body).toContain('const live = nodeId ? ptyManager.sshRemoteForNode(nodeId) : undefined')
    expect(body).toContain('if (!remote && !live) return null')
  })

  it('refuses a remote codex/gemini node instead of reading this machine', () => {
    // Same boundary the hook raw-listener draws: remote-context-tail.ts parses claude's usage
    // records and the locator searches claude's roots, so there is no remote meter for the others.
    expect(ensureRemoteBody()).toContain("if (agentId && agentId !== 'claude') return 'unresolved'")
  })

  it('caches nothing on an unresolved attempt', () => {
    const body = ensureRemoteBody()
    // Only a HIT is remembered, and `remoteTranscriptRefFor` is what remembers it. Nothing here may
    // record an absence: a momentarily dead ControlMaster must not look like a deleted transcript,
    // or the meter stays blank until the session's next turn — the bug, by another route.
    expect(body).not.toMatch(/\.(add|set)\(/)
  })
})

describe('both shells serve it', () => {
  // The repo has shipped a one-shell hook/transcript change three times; the Server Edition had no
  // `context:ensure` handler AT ALL before this, which is why its meters filled only on the next
  // turn too. The asymmetry that IS legitimate: only the desktop passes `ensureRemote`, because
  // only it has an SSH-project manager — the server runs ON the host whose transcripts it reads.
  it('the server registers the same handler, local-only', () => {
    expect(SERVER).toContain('registerContextEnsureIpc({')
    expect(SERVER).not.toContain('ensureRemote')
  })

  it('the server registers it once, with no second listener of its own', () => {
    // This shell used to register the channel twice (agent-status.ts and index.ts), so every
    // browser ensure resolved twice through two different claude fallbacks.
    for (const name of readdirSync(SERVER_DIR)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
      const text = readFileSync(path.join(SERVER_DIR, name), 'utf8')
      expect(text, name).not.toMatch(/IPC\.contextEnsure/)
    }
    expect(SERVER.split('registerContextEnsureIpc({').length - 1).toBe(1)
  })

  it('the server jails located paths and records the node it meters', () => {
    const body = SERVER.slice(SERVER.indexOf('registerContextEnsureIpc({'))
    expect(body).toContain('admitLocalPath: admitTranscriptPath')
    expect(body).toContain('noteContextNode(nodeId, sessionId, agentId ?? \'claude\')')
  })
})
