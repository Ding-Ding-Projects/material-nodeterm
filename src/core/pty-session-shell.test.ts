// The session-host backend must not ask for a POSIX shell on the platform it exists for.
//
// It is selected precisely WHEN tmux is absent — which in practice means Windows. Its spawn
// options hard-coded `program || settings.defaultShell || 'bash'`, so on a machine with no
// configured default shell the host dutifully tried to spawn `bash`, node-pty answered
// `File not found:`, and the attach rejected.
//
// Measured directly against a running host, which is what identified it:
//
//   shell='bash'            → {"ok":false,"error":"Error: File not found: "}
//   shell='powershell.exe'  → {"ok":true,"result":{"fresh":true}}
//
// The ordinary pty branch two hundred lines above had always resolved this correctly, via
// `resolveWindowsShell()`. Two places deciding one question is what let them disagree, so there
// is now one resolver and this pins that there stays one.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(join(__dirname, 'pty-manager.ts'), 'utf8')

describe('one shell resolver, used by both persistence backends', () => {
  it('the session-host spawn resolves its shell instead of hard-coding one', () => {
    const call = /createSessionHostPty\([\s\S]*?\n      \)/.exec(SRC)?.[0] ?? ''
    expect(call, 'the createSessionHostPty call was not found').toContain('shell:')
    expect(call).toContain('resolveSessionShell(')
  })

  it("no branch falls back to 'bash' on its own any more", () => {
    // The needle that matters: a bare `|| 'bash'` anywhere outside the one resolver is the exact
    // regression. Inside the resolver it is correct — it is the POSIX arm of a platform check.
    const resolver = /function resolveSessionShell\([\s\S]*?\n\}/.exec(SRC)?.[0] ?? ''
    expect(resolver, 'resolveSessionShell not found').toContain("'bash'")
    // Strip comments first. The fix's own comment quotes the old `|| 'bash'` to explain what went
    // wrong, and flagging that would teach the next person to delete the explanation — which is
    // the most valuable line in the file.
    const code = SRC.replace(resolver, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    const strays = code.match(/\|\|\s*'bash'/g) || []
    expect(strays, 'a second bash fallback has reappeared outside the resolver').toEqual([])
  })

  it('the resolver consults the platform, not just the setting', () => {
    const resolver = /function resolveSessionShell\([\s\S]*?\n\}/.exec(SRC)?.[0] ?? ''
    expect(resolver).toContain('resolveWindowsShell()')
    expect(resolver).toMatch(/win32/)
  })

  it('both call sites go through it', () => {
    expect((SRC.match(/resolveSessionShell\(/g) || []).length).toBeGreaterThanOrEqual(3) // def + 2 uses
  })
})

describe('a failed attach is neither silent nor reported as success', () => {
  it('says so, rather than swallowing the reason', () => {
    // It was a bare `catch {}`. That silence is the only reason a completely broken backend
    // survived: every terminal quietly fell back and nothing anywhere said a word.
    const branch = /if \(spawned\?\.sessionHost\) \{[\s\S]*?\n    \}/.exec(SRC)?.[0] ?? ''
    expect(branch, 'the sessionHost ready-await branch was not found').toContain('catch (e)')
    expect(branch).toContain('will NOT survive a restart')
  })

  it('`persistent` reflects the OUTCOME, not the path chosen', () => {
    // It was `!!spawned?.persistKey` — true whenever the session-host path was SELECTED, even
    // when the attach had just failed. The renderer then believed a throwaway shell would
    // survive a restart, and every memory lever that spares a persistent session was reasoning
    // about a session that did not exist.
    expect(SRC).toMatch(/const persistent = !!spawned\?\.persistKey && !sessionHostAttachFailed/)
  })
})
