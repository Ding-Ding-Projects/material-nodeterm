import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { immutableIconUrl, readReleaseIdentity, resolveSourceIdentity, sourceIdentityFromIconMetadata } from './windows-installer.mjs'

/**
 * `resolveSourceIdentity` is what stops a release being packaged from something other than the
 * commit it claims: a dirty tree, or a checkout that disagrees with `GITHUB_SHA`.
 *
 * The property used to be covered only by an inline workflow assertion. These tests pin the
 * behavior where the release wrapper actually reads it, so a moved or removed assertion cannot
 * quietly leave the source identity untested.
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
  it('refuses a GITHUB_SHA that does not match the checked-out commit', () => {
    // A runner whose checkout drifted from the commit the run claims would otherwise package one
    // commit's source and publish it under another's tag.
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
  it('refuses an untracked file', () => {
    // Untracked counts too, because the packaging step can still pick up and ship such a file.
    const stray = join(repo, 'stray.txt')
    writeFileSync(stray, 'x\n')
    try {
      expect(() => resolveSourceIdentity(repo, {})).toThrow(/dirty source tree/)
    } finally {
      rmSync(stray, { force: true })
    }
  })
  it('refuses any own signAndEditExecutable property and accepts omission', async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'nodeterm-release-identity-'))
    const fixturePath = join(fixtureRoot, 'package.json')
    try {
      const baseline = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
      for (const value of [true, false]) {
        const fixture = structuredClone(baseline)
        fixture.build.win.signAndEditExecutable = value
        writeFileSync(fixturePath, JSON.stringify(fixture))
        await expect(readReleaseIdentity(fixturePath)).rejects.toThrow(/signAndEditExecutable must be omitted/)
      }
      writeFileSync(fixturePath, JSON.stringify(baseline))
      await expect(readReleaseIdentity(fixturePath)).resolves.toBeDefined()
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
})

describe('sourceIdentityFromIconMetadata', () => {
  const sourceSha = 'a'.repeat(40)
  const repository = 'Ding-Ding-Projects/material-nodeterm'
  const metadata = {
    schemaVersion: 1,
    sourceSha,
    repository,
    iconUrl: immutableIconUrl(repository, sourceSha),
    sha256: 'b'.repeat(64),
    frames: [16, 24, 32, 48, 64, 128, 256],
  }

  it('reuses the validated pre-bootstrap identity for standalone package verification', () => {
    expect(sourceIdentityFromIconMetadata(metadata)).toEqual({ sourceSha, repository })
  })

  it('refuses malformed metadata rather than accepting an arbitrary standalone identity', () => {
    expect(() => sourceIdentityFromIconMetadata({ ...metadata, sourceSha: 'not-a-sha' })).toThrow(/source SHA|commit SHA/i)
  })
})
