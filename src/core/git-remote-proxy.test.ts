import { describe, it, expect } from 'vitest'
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
  function stubGit(dir: string, script: string): string {
    const bin = path.join(dir, 'git')
    fs.writeFileSync(bin, `#!/bin/sh\n${script}`, { mode: 0o755 })
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
      const bin = stubGit(dir, 'echo "args: $@"; echo "boo" >&2; exit 0')
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
      const bin = stubGit(dir, 'echo "fatal: could not read Username" >&2; exit 128')
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
      const bin = stubGit(dir, 'echo "$GIT_TERMINAL_PROMPT|$LC_ALL"')
      const r = await runGitRemoteOp({ cwd: dir, op: 'fetch' }, { gitBin: bin })
      expect(r.stdout).toContain('0|C')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
