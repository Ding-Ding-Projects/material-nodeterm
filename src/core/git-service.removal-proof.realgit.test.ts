import { execFileSync } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GitService } from './git-service'

let repo: string
const run = (...args: string[]): void => {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
}

describe('GitService destructive worktree proof (real git)', () => {
  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-wt-proof-'))
    run('init')
    run('config', 'user.email', 'chut@example.test')
    run('config', 'user.name', 'Chut')
    await fs.writeFile(path.join(repo, 'tracked.txt'), 'alpha\n')
    run('add', 'tracked.txt')
    run('commit', '-m', 'fixture')
  })

  afterEach(async () => fs.rm(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))

  it('changes for nested untracked bytes even when the visible status row is unchanged', async () => {
    const service = new GitService()
    await fs.mkdir(path.join(repo, 'scratch'))
    await fs.writeFile(path.join(repo, 'scratch', 'important.bin'), 'AAAA')
    const before = await service.status(repo)
    await fs.writeFile(path.join(repo, 'scratch', 'important.bin'), 'BBBB')
    const after = await service.status(repo)

    expect(before.authoritative).toBe(true)
    expect(after.authoritative).toBe(true)
    expect(before.changes).toEqual(after.changes)
    expect(after.removalProof?.fingerprint).not.toBe(before.removalProof?.fingerprint)
  })
})
