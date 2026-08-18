import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { argsForRemoteOp, isSafeBranch, runGitRemoteOp } from './git-remote-proxy'

describe('argsForRemoteOp (whitelist)', () => {
  it('maps each allowed op to fixed argv', () => {
    expect(argsForRemoteOp('fetch')).toEqual(['fetch'])
    expect(argsForRemoteOp('pull')).toEqual(['pull'])
    expect(argsForRemoteOp('push')).toEqual(['push'])
    expect(argsForRemoteOp('force-push')).toEqual(['push', '--force-with-lease'])
    expect(argsForRemoteOp('push-set-upstream', 'feat/x')).toEqual(['push', '-u', 'origin', 'feat/x'])
  })

  it('refuses unknown ops and set-upstream without a valid branch', () => {
    expect(argsForRemoteOp('clone')).toBeNull()
    expect(argsForRemoteOp('push; rm -rf /')).toBeNull()
    expect(argsForRemoteOp('push-set-upstream')).toBeNull()
    expect(argsForRemoteOp('push-set-upstream', '--force')).toBeNull()
  })
})

describe('isSafeBranch', () => {
  it('accepts real branch names, including slashes and unicode', () => {
    for (const b of ['main', 'feat/x-1', 'fix_#42', 'feat(x)', 'işler']) {
      expect(isSafeBranch(b), b).toBe(true)
    }
  })

  it('rejects option flags, revision syntax and whitespace', () => {
    for (const b of ['', '-f', '--force', 'a..b', 'a b', 'a\nb', 'a~1', 'x^', 'a:b', 'a?', '@{u}', 'x.lock']) {
      expect(isSafeBranch(b), JSON.stringify(b)).toBe(false)
    }
  })
})

describe('runGitRemoteOp', () => {
  // `runGitRemoteOp` launches `opts.gitBin` directly via `execFile` -- no shell, by design (see
  // the security note atop git-remote-proxy.ts: "git runs via execFile (no shell)"). A POSIX
  // shebang script cannot be launched that way on Windows at all -- CreateProcess has no notion
  // of `#!` -- so the stub needs a real, directly-launchable Windows executable. It can't be a
  // real interpreter (node, sh, powershell) either: every one of them recognizes a `-C` flag of
  // its own (node's --conditions, sh's noclobber, PowerShell's -Command) and CONSUMES the literal
  // `-C <cwd>` prefix before it ever reaches a script -- which would silently defeat the very
  // thing these tests exist to prove, that the whitelisted argv IS `-C <cwd> <op>` (verified: `sh
  // -C <script> push` only sees "push" in $@, never "-C" or the path). So on Windows the stub is
  // a genuinely dumb executable, compiled fresh per test from the .NET Framework's bundled
  // csc.exe (shipped with every Windows install, not an optional download): it does no argv
  // parsing of its own and hands the raw args straight to `Main`, exactly like the POSIX shebang
  // script does everywhere else.
  function findCsc(): string {
    const candidates = [
      'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
      'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    return 'csc.exe'
  }

  function stubGitWindows(dir: string, mainBody: string): string {
    const src = path.join(dir, 'stub.cs')
    const exe = path.join(dir, 'git.exe')
    fs.writeFileSync(
      src,
      `using System;\nclass Stub {\n  static int Main(string[] args) {\n${mainBody}\n  }\n}\n`
    )
    execFileSync(findCsc(), ['/nologo', `/out:${exe}`, src])
    return exe
  }

  // `posixScript` and `windowsBody` are the SAME behavior expressed twice: a POSIX `/bin/sh`
  // fragment (interpolated verbatim into a shebang script, as before) and the equivalent C#
  // `Main` body for the Windows stub above. Keep them in lockstep when a test's expectations
  // change.
  function stubGit(dir: string, posixScript: string, windowsBody: string): string {
    if (process.platform === 'win32') return stubGitWindows(dir, windowsBody)
    const bin = path.join(dir, 'git')
    fs.writeFileSync(bin, `#!/bin/sh\n${posixScript}`, { mode: 0o755 })
    return bin
  }

  it('refuses invalid requests without spawning anything', async () => {
    const bad = await runGitRemoteOp({ cwd: '/tmp', op: 'clone' })
    expect(bad.ok).toBe(false)
    expect(bad.exitCode).toBe(-1)
    const rel = await runGitRemoteOp({ cwd: 'relative/path', op: 'fetch' })
    expect(rel.ok).toBe(false)
  })

  it('runs the whitelisted argv and returns exit/stdout/stderr', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-proxy-'))
    try {
      const bin = stubGit(
        dir,
        'echo "args: $@"; echo "boo" >&2; exit 0',
        'Console.Out.Write("args: " + string.Join(" ", args) + "\\n");\n' +
          '    Console.Error.Write("boo\\n");\n' +
          '    return 0;'
      )
      const r = await runGitRemoteOp({ cwd: dir, op: 'push' }, { gitBin: bin })
      expect(r.ok).toBe(true)
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain('args: -C')
      expect(r.stdout).toContain('push')
      expect(r.stderr).toContain('boo')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('surfaces a non-zero exit as ok:false with stderr intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-proxy-'))
    try {
      const bin = stubGit(
        dir,
        'echo "fatal: could not read Username" >&2; exit 128',
        'Console.Error.Write("fatal: could not read Username\\n");\n    return 128;'
      )
      const r = await runGitRemoteOp({ cwd: dir, op: 'pull' }, { gitBin: bin })
      expect(r.ok).toBe(false)
      expect(r.exitCode).toBe(128)
      expect(r.stderr).toContain('could not read Username')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes GIT_TERMINAL_PROMPT=0 and LC_ALL=C to the child', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-proxy-'))
    try {
      const bin = stubGit(
        dir,
        'echo "$GIT_TERMINAL_PROMPT|$LC_ALL"',
        'Console.Out.Write((Environment.GetEnvironmentVariable("GIT_TERMINAL_PROMPT") ?? "") + "|" + ' +
          '(Environment.GetEnvironmentVariable("LC_ALL") ?? "") + "\\n");\n    return 0;'
      )
      const r = await runGitRemoteOp({ cwd: dir, op: 'fetch' }, { gitBin: bin })
      expect(r.stdout).toContain('0|C')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
