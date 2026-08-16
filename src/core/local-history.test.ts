import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalHistoryStore, type LocalHistoryGit } from './local-history'

const execFileP = promisify(execFile)

const realGit: LocalHistoryGit = (cwd, args) =>
  execFileP('git', args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  })

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('LocalHistoryStore', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })

  function makeStore(runGit: LocalHistoryGit = realGit): LocalHistoryStore {
    const dir = mkdtempSync(path.join(tmpdir(), 'nodeterm-local-history-'))
    dirs.push(dir)
    return new LocalHistoryStore(dir, runGit)
  }

  it('reports an initialized but unborn repository as an empty readable history', async () => {
    const store = makeStore()

    await expect(store.list('settings')).resolves.toEqual([])
  }, 30_000)

  it('serializes the complete write/add/commit decision so every label owns its content', async () => {
    const firstCommitEntered = deferred()
    const releaseFirstCommit = deferred()
    let commitCalls = 0
    const gatedGit: LocalHistoryGit = async (cwd, args) => {
      if (args[0] === 'commit') {
        commitCalls += 1
        if (commitCalls === 1) {
          firstCommitEntered.resolve()
          await releaseFirstCommit.promise
        }
      }
      return realGit(cwd, args)
    }
    const store = makeStore(gatedGit)

    const first = store.record({
      domain: 'settings',
      filename: 'settings.json',
      content: '{"fontSize":11}',
      label: 'first settings save',
      action: 'updated'
    })
    await firstCommitEntered.promise
    const second = store.record({
      domain: 'settings',
      filename: 'settings.json',
      content: '{"fontSize":22}',
      label: 'second settings save',
      action: 'updated'
    })

    // Keep A paused long enough for an unqueued B to stage/commit the shared index. With the
    // per-domain lane B cannot enter the transaction yet. Removing that lane makes this test
    // deterministically lose A (its later commit sees B's clean index).
    await new Promise((resolve) => setTimeout(resolve, 40))
    releaseFirstCommit.resolve()
    await Promise.all([first, second])

    const entries = await store.list('settings')
    expect(entries?.map((entry) => entry.label)).toEqual([
      'second settings save',
      'first settings save'
    ])
    expect(await store.restoreContent('settings', entries![0].sha, 'settings.json')).toBe(
      '{"fontSize":22}'
    )
    expect(await store.restoreContent('settings', entries![1].sha, 'settings.json')).toBe(
      '{"fontSize":11}'
    )
  }, 30_000)

  it('makes list a read-after-write barrier for the background recorder', async () => {
    const commitEntered = deferred()
    const releaseCommit = deferred()
    const gatedGit: LocalHistoryGit = async (cwd, args) => {
      if (args[0] === 'commit') {
        commitEntered.resolve()
        await releaseCommit.promise
      }
      return realGit(cwd, args)
    }
    const store = makeStore(gatedGit)
    const write = store.record({
      domain: 'settings',
      filename: 'settings.json',
      content: '{"theme":"night"}',
      label: 'restored settings',
      action: 'restored'
    })
    await commitEntered.promise

    let readSettled = false
    const read = store.list('settings').then((entries) => {
      readSettled = true
      return entries
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(readSettled).toBe(false)

    releaseCommit.resolve()
    await write
    await expect(read).resolves.toMatchObject([{ label: 'restored settings', action: 'restored' }])
  }, 30_000)
})
