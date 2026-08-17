import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { afterEach, describe, expect, it } from 'vitest'
import type { GitWorktreeRemovalProof } from '../shared/types'
import type { GitExecutor } from '../shared/worktree-ops'
import { GitService } from './git-service'
import { initPlatform, resetPlatformForTests, type CorePlatform } from './platform'
import { WorktreeOwnershipStore } from './worktree-ownership'
import {
  measureStableWorktreeRemoval,
  strictPathPresent,
  WorktreeRemovalProofRegistry
} from './worktree-removal-proof'

const run = promisify(execFile)
const roots = new Set<string>()

interface Fixture {
  root: string
  repo: string
  worktree: string
  git: GitExecutor
  ownership: WorktreeOwnershipStore
}

async function createFixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-worktree-proof-'))
  roots.add(root)
  const repo = path.join(root, 'repo space')
  const worktree = path.join(root, 'worktree space')
  await fs.mkdir(repo)

  const git: GitExecutor = async (cwd, args) => {
    try {
      const { stdout } = await run('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      })
      return { ok: true, out: stdout.replace(/\r?\n$/, ''), err: '' }
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string; message?: string }
      return {
        ok: false,
        out: failed.stdout ?? '',
        err: failed.stderr ?? failed.message ?? 'git failed'
      }
    }
  }
  const mustGit = async (cwd: string, args: string[]): Promise<string> => {
    const result = await git(cwd, args)
    if (!result.ok) throw new Error(result.err)
    return result.out
  }

  await mustGit(repo, ['init', '-b', 'main'])
  await mustGit(repo, ['config', 'user.email', 'proof@example.invalid'])
  await mustGit(repo, ['config', 'user.name', 'Proof Fixture'])
  await mustGit(repo, ['config', 'core.autocrlf', 'false'])
  await fs.writeFile(path.join(repo, '.gitignore'), 'ignored/**\n')
  await fs.writeFile(path.join(repo, 'tracked.bin'), 'BASE')
  await mustGit(repo, ['add', '--', '.gitignore', 'tracked.bin'])
  await mustGit(repo, ['commit', '-m', 'fixture'])
  await mustGit(repo, ['worktree', 'add', '-b', 'feature-a', '--', worktree, 'HEAD'])
  await mustGit(repo, ['branch', 'feature-b', 'HEAD'])
  await fs.mkdir(path.join(worktree, 'ignored', 'empty'), { recursive: true })
  await fs.writeFile(path.join(worktree, 'ignored', 'secret.bin'), 'AAAA')
  await fs.writeFile(path.join(worktree, 'draft.bin'), 'CCCC')

  return {
    root,
    repo: await fs.realpath(repo),
    worktree: await fs.realpath(worktree),
    git,
    ownership: new WorktreeOwnershipStore(() => path.join(root, 'ownership.json'))
  }
}

afterEach(async () => {
  resetPlatformForTests()
  for (const root of roots) {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 })
    roots.delete(root)
  }
})

describe('worktree removal proof', () => {
  it('mints an opaque one-shot proof bound to complete ignored and untracked bytes', async () => {
    const fixture = await createFixture()
    const registry = new WorktreeRemovalProofRegistry()
    const prepared = await registry.prepare(
      fixture.git,
      fixture.ownership,
      fixture.repo,
      fixture.worktree
    )
    expect(prepared.ok).toBe(true)
    expect(prepared.proof?.branchRef).toBe('refs/heads/feature-a')
    expect(prepared.proof?.summary.ignoredFiles).toBe(1)
    expect(prepared.proof?.summary.untrackedFiles).toBe(1)
    expect(prepared.proof?.summary.directories).toBeGreaterThanOrEqual(2)
    expect(prepared.proof?.ownership).toEqual({
      ownershipId: undefined,
      directoryCreatedByApp: false,
      branchCreatedByApp: false
    })

    const second = await registry.prepare(
      fixture.git,
      fixture.ownership,
      fixture.repo,
      fixture.worktree
    )
    expect(second.proof?.token).not.toBe(prepared.proof?.token)

    const consumed = registry.consume(prepared.proof!)
    expect(consumed.fingerprint).toBe(prepared.proof?.fingerprint)
    expect(() => registry.consume(prepared.proof!)).toThrow(/already used/i)

    const ignored = path.join(fixture.worktree, 'ignored', 'secret.bin')
    const ignoredTimes = await fs.stat(ignored)
    await fs.writeFile(ignored, 'BBBB')
    await fs.utimes(ignored, ignoredTimes.atime, ignoredTimes.mtime)
    const afterIgnored = await measureStableWorktreeRemoval(
      fixture.git,
      fixture.ownership,
      fixture.repo,
      fixture.worktree
    )
    expect(afterIgnored.fingerprint).not.toBe(second.proof?.fingerprint)

    // A changed public object consumes its private token too: restoring bytes cannot replay it.
    const changed = { ...second.proof!, fingerprint: '0'.repeat(64) }
    expect(() => registry.consume(changed)).toThrow(/changed/i)
    expect(() => registry.consume(second.proof!)).toThrow(/already used/i)
  })

  it('changes identity on a same-tip symbolic-branch switch', async () => {
    const fixture = await createFixture()
    const before = await measureStableWorktreeRemoval(
      fixture.git,
      fixture.ownership,
      fixture.repo,
      fixture.worktree
    )
    const switched = await fixture.git(fixture.worktree, ['switch', 'feature-b'])
    expect(switched.ok).toBe(true)
    const after = await measureStableWorktreeRemoval(
      fixture.git,
      fixture.ownership,
      fixture.repo,
      fixture.worktree
    )
    expect(after.branchTip).toBe(before.branchTip)
    expect(after.binding.branchRef).toBe('refs/heads/feature-b')
    expect(after.fingerprint).not.toBe(before.fingerprint)
  })

  it('treats only ENOENT as absence and propagates every failed read', async () => {
    await expect(
      strictPathPresent('missing', async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      })
    ).resolves.toBe(false)
    for (const code of ['ENOTDIR', 'EACCES', 'EIO']) {
      await expect(
        strictPathPresent('unavailable', async () => {
          throw Object.assign(new Error(code), { code })
        })
      ).rejects.toMatchObject({ code })
    }
  })

  it('requires a core-issued proof at the local service boundary', async () => {
    const fixture = await createFixture()
    const service = new GitService()
    const registry = new WorktreeRemovalProofRegistry()
    const foreign = await registry.prepare(
      fixture.git,
      fixture.ownership,
      fixture.repo,
      fixture.worktree
    )
    const attempts = [
      undefined as never,
      { mode: 'remove', proof: null, deleteBranch: true } as never,
      { mode: 'remove', proof: foreign.proof as GitWorktreeRemovalProof, deleteBranch: true } as const
    ]
    for (const request of attempts) {
      const result = await service.worktreeRemove(fixture.repo, fixture.worktree, request)
      expect(result.ok).toBe(false)
      expect(result.worktreeGone).toBeUndefined()
      expect(await strictPathPresent(fixture.worktree)).toBe(true)
    }
    const listed = await fixture.git(fixture.repo, ['worktree', 'list', '--porcelain'])
    expect(listed.out).toContain(fixture.worktree.replace(/\\/g, '/'))
    const branch = await fixture.git(fixture.repo, ['show-ref', '--verify', 'refs/heads/feature-a'])
    expect(branch.ok).toBe(true)
  })

  it('keeps an adopted branch but CAS-deletes a locally created branch at its exact tip', async () => {
    const fixture = await createFixture()
    const userDataDir = path.join(fixture.root, 'user-data')
    await fs.mkdir(userDataDir)
    initPlatform({
      userDataDir,
      appVersion: 'test',
      isPackaged: false,
      handle: () => undefined,
      on: () => undefined,
      handleWithSender: () => undefined,
      onWithSender: () => undefined,
      sendTo: () => undefined,
      broadcast: () => undefined,
      clientIds: () => [],
      openExternal: async () => undefined
    } satisfies CorePlatform)
    const service = new GitService()

    const adoptedProof = await service.worktreeRemovalProof(fixture.repo, fixture.worktree)
    expect(adoptedProof.ok).toBe(true)
    expect(adoptedProof.proof?.ownership.branchCreatedByApp).toBe(false)
    const adoptedRemoved = await service.worktreeRemove(fixture.repo, fixture.worktree, {
      mode: 'remove',
      proof: adoptedProof.proof!,
      deleteBranch: true
    })
    expect(adoptedRemoved.ok).toBe(true)
    expect(await strictPathPresent(fixture.worktree)).toBe(false)
    expect((await fixture.git(fixture.repo, ['show-ref', '--verify', 'refs/heads/feature-a'])).ok)
      .toBe(true)

    const existingPath = path.join(fixture.root, 'existing worktree')
    const existing = await service.worktreeAdd(
      fixture.repo,
      existingPath,
      'feature-b',
      'main',
      false
    )
    expect(existing.ok).toBe(true)
    expect(existing.worktreeOwnership?.directoryCreatedByApp).toBe(true)
    expect(existing.worktreeOwnership?.branchCreatedByApp).toBe(false)
    const existingProof = await service.worktreeRemovalProof(fixture.repo, existingPath)
    const existingRemoved = await service.worktreeRemove(fixture.repo, existingPath, {
      mode: 'remove',
      proof: existingProof.proof!,
      deleteBranch: true
    })
    expect(existingRemoved.ok).toBe(true)
    expect((await fixture.git(fixture.repo, ['show-ref', '--verify', 'refs/heads/feature-b'])).ok)
      .toBe(true)

    const ownedPath = path.join(fixture.root, 'owned worktree')
    const created = await service.worktreeAdd(
      fixture.repo,
      ownedPath,
      'owned-feature',
      'main',
      true
    )
    expect(created.ok).toBe(true)
    expect(created.worktreeOwnership?.branchCreatedByApp).toBe(true)
    const ownedProof = await service.worktreeRemovalProof(fixture.repo, ownedPath)
    expect(ownedProof.ok).toBe(true)
    expect(ownedProof.proof?.ownership.branchCreatedByApp).toBe(true)
    const ownedTip = ownedProof.proof!.branchTip
    const ownedRemoved = await service.worktreeRemove(fixture.repo, ownedPath, {
      mode: 'remove',
      proof: ownedProof.proof!,
      deleteBranch: true
    })
    expect(ownedRemoved.ok).toBe(true)
    expect(ownedRemoved.message).toContain('Branch owned-feature deleted.')
    expect((await fixture.git(fixture.repo, ['show-ref', '--verify', 'refs/heads/owned-feature'])).ok)
      .toBe(false)
    expect(ownedTip).toMatch(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/)
  })
})
