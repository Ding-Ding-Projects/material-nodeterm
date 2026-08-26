import { describe, it, expect } from 'vitest'
import { publishRepo } from './publish-repo'

const good = { name: 'my-installer', owner: 'someuser', projectDir: 'C:\\project' }

function ghOk(
  overrides: Record<string, (args: string[]) => { exitCode: number; stdout: string; stderr: string }> = {}
) {
  return async (file: string, args: string[]) => {
    expect(file).toBe('gh') // never a raw REST client
    const key = args[0] === 'repo' ? `repo:${args[1]}` : args[0]
    if (overrides[key]) return overrides[key](args)
    if (args[0] === '--version') return { exitCode: 0, stdout: 'gh version 2.0.0', stderr: '' }
    if (args[0] === 'api') return { exitCode: 1, stdout: '', stderr: 'not found' } // repo doesn't exist yet
    if (key === 'repo:create') return { exitCode: 0, stdout: 'created', stderr: '' }
    if (key === 'repo:sync') return { exitCode: 0, stdout: 'synced', stderr: '' }
    if (key === 'repo:view')
      return { exitCode: 0, stdout: 'https://github.com/someuser/my-installer\n', stderr: '' }
    return { exitCode: 1, stdout: '', stderr: 'unexpected call' }
  }
}

describe('publishRepo', () => {
  it('refuses without an explicit repository name -- never invents one', async () => {
    const result = await publishRepo({ ...good, name: '' }, { run: ghOk() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('name-required')
  })

  it('refuses without an owner', async () => {
    const result = await publishRepo({ ...good, owner: '' }, { run: ghOk() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('owner-required')
  })

  it('refuses without a project directory', async () => {
    const result = await publishRepo({ ...good, projectDir: '' }, { run: ghOk() })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('project-dir-required')
  })

  it('reports gh-not-found when the gh CLI is unavailable', async () => {
    const result = await publishRepo(good, {
      run: async () => ({ exitCode: 1, stdout: '', stderr: 'command not found' }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('gh-not-found')
  })

  it('refuses to push into an existing NON-EMPTY repository', async () => {
    const result = await publishRepo(good, {
      run: ghOk({
        api: () => ({ exitCode: 0, stdout: '4200', stderr: '' }), // size > 0 KB
      }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('repo-already-exists-nonempty')
  })

  it('proceeds when an existing repo is EMPTY (size 0)', async () => {
    const result = await publishRepo(good, {
      run: ghOk({
        api: () => ({ exitCode: 0, stdout: '0', stderr: '' }),
      }),
    })
    expect(result.ok).toBe(true)
  })

  it('defaults to PRIVATE when `private` is not specified', async () => {
    const seenArgs: string[][] = []
    const run = async (file: string, args: string[]) => {
      seenArgs.push(args)
      return ghOk()(file, args)
    }
    await publishRepo(good, { run })
    const createCall = seenArgs.find((a) => a[0] === 'repo' && a[1] === 'create')
    expect(createCall).toBeDefined()
    expect(createCall).toContain('--private')
    expect(createCall).not.toContain('--public')
  })

  it('goes public only on an explicit `private: false`', async () => {
    const seenArgs: string[][] = []
    const run = async (file: string, args: string[]) => {
      seenArgs.push(args)
      return ghOk()(file, args)
    }
    await publishRepo({ ...good, private: false }, { run })
    const createCall = seenArgs.find((a) => a[0] === 'repo' && a[1] === 'create')
    expect(createCall).toContain('--public')
    expect(createCall).not.toContain('--private')
  })

  it('returns the URL gh actually reports, never a guessed one', async () => {
    const result = await publishRepo(good, {
      run: ghOk({
        'repo:view': () => ({
          exitCode: 0,
          stdout: 'https://github.example.com/enterprise/my-installer\n',
          stderr: '',
        }),
      }),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.url).toBe('https://github.example.com/enterprise/my-installer')
  })

  it('reports gh-create-failed with the real stderr on a failed create', async () => {
    const result = await publishRepo(good, {
      run: ghOk({
        'repo:create': () => ({ exitCode: 1, stdout: '', stderr: 'HTTP 422: name already exists' }),
      }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('gh-create-failed')
      expect(result.detail).toContain('422')
    }
  })

  it('reports gh-push-failed distinctly from gh-create-failed', async () => {
    const result = await publishRepo(good, {
      run: ghOk({
        'repo:sync': () => ({ exitCode: 1, stdout: '', stderr: 'nothing to push' }),
      }),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('gh-push-failed')
  })

  it('never calls anything other than the gh CLI', async () => {
    let calledOther = false
    const run = async (file: string, args: string[]) => {
      if (file !== 'gh') calledOther = true
      return ghOk()(file, args)
    }
    await publishRepo(good, { run })
    expect(calledOther).toBe(false)
  })
})
