import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveSourceIdentity } from './windows-installer.mjs'

/**
 * `resolveSourceIdentity` is what stops a release being packaged from something other than the
 * commit it claims: a dirty tree, or a checkout that disagrees with `GITHUB_SHA`.
 *
 * It had NO test. The proof used to live in the release workflow as an inline
 * `if [[ "$checked_out" != "$GITHUB_SHA" ]]` step, and a mutation test in
 * `release-workflow-contract.test.ts` covered it there. When releasing became automatic on
 * 2026-08-18 that step was removed and the proof moved here — but the mutation stayed behind,
 * aimed at a string that no longer exists, so it threw "mutation target not found" rather than
 * proving anything. The property looked covered from both sides and was covered from neither.
 *
 * That is the same shape this repository has already recorded twice: a guard catches a thing done
 * WRONGLY and never a thing not done at all, so a check whose target moved silently stops
 * checking. These tests pin the property where it actually lives now.
 */
describe('resolveSourceIdentity', () => {
  let repo = ''
  let head = ''

  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'nodeterm-source-identity-'))
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@nodeterm.invalid')
    git('remote', 'add', 'origin', 'https://github.com/Ding-Ding-Projects/material-nodeterm.git')
    writeFileSync(join(repo, 'file.txt'), 'one\n')
    git('add', '-A')
    git('commit', '-qm', 'initial')
    head = git('rev-parse', '--verify', 'HEAD')
  })

  afterAll(() => {
    if (repo) rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  })

  it('accepts a clean tree and reports the checked-out commit', () => {
    const identity = resolveSourceIdentity(repo, {})
    expect(identity.sourceSha).toBe(head)
    expect(identity.repository).toBe('Ding-Ding-Projects/material-nodeterm')
  })

  it('accepts a GITHUB_SHA that matches the checked-out commit', () => {
    expect(resolveSourceIdentity(repo, { GITHUB_SHA: head }).sourceSha).toBe(head)
  })

  // The one that matters: a runner whose checkout drifted from the commit the run claims would
  // otherwise package one commit's source and publish it under another's tag.
  it('refuses a GITHUB_SHA that does not match the checked-out commit', () => {
    expect(() => resolveSourceIdentity(repo, { GITHUB_SHA: 'b'.repeat(40) })).toThrow(
      /GITHUB_SHA does not match checked-out HEAD/
    )
  })

  it('refuses a tracked modification', () => {
    writeFileSync(join(repo, 'file.txt'), 'two\n')
    try {
      expect(() => resolveSourceIdentity(repo, {})).toThrow(/dirty source tree/)
    } finally {
      git('checkout', '--', 'file.txt')
    }
  })

  // Untracked counts too, and deliberately: the status read passes --untracked-files=all, because
  // a file nobody committed can still be picked up by the packaging step and shipped.
  it('refuses an untracked file', () => {
    const stray = join(repo, 'stray.txt')
    writeFileSync(stray, 'x\n')
    try {
      expect(() => resolveSourceIdentity(repo, {})).toThrow(/dirty source tree/)
    } finally {
      rmSync(stray, { force: true })
    }
  })
})
