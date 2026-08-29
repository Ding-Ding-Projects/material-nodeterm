import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RepositoryGraphService } from './repository-graph-service'

describe('RepositoryGraphService compiler integration', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  })

  it('uses the declared TypeScript compiler API to parse a code snapshot', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'nodeterm-repository-graph-'))
    const userDataDir = await mkdtemp(join(tmpdir(), 'nodeterm-repository-graph-data-'))
    temporaryDirectories.push(projectRoot, userDataDir)
    await writeFile(join(projectRoot, 'index.ts'), 'export function greet(name: string): string { return `Hello ${name}` }\n')

    const service = new RepositoryGraphService({
      userDataDir,
      projectTargetInfo: () => ({ cwd: projectRoot, name: 'Compiler fixture' })
    })

    const snapshot = await service.refresh({ projectId: 'compiler-fixture', mode: 'code' })

    expect(snapshot.status).toBe('ready')
    expect(snapshot.nodes.some((node) => node.kind === 'file' && node.label === 'index.ts')).toBe(true)
    expect(snapshot.nodes.some((node) => node.kind === 'symbol' && node.label === 'greet')).toBe(true)
  })

  it('reuses a combined cache for narrower views, without labelling a fresh snapshot stale', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'nodeterm-repository-graph-'))
    const userDataDir = await mkdtemp(join(tmpdir(), 'nodeterm-repository-graph-data-'))
    temporaryDirectories.push(projectRoot, userDataDir)
    await writeFile(join(projectRoot, 'index.ts'), 'export const answer = 42\n')
    await writeFile(join(projectRoot, 'package.json'), JSON.stringify({ dependencies: { '@scope/tool': '1.0.0' } }))
    const service = new RepositoryGraphService({ userDataDir, projectTargetInfo: () => ({ cwd: projectRoot, name: 'Cache fixture' }) })

    const combined = await service.refresh({ projectId: 'cache-fixture', mode: 'combined' })
    expect(combined.status).toBe('ready')
    expect((await service.inspect('cache-fixture', 'code')).mode).toBe('code')
    expect((await service.inspect('cache-fixture', 'dependencies')).nodes.some((node) => node.kind === 'package')).toBe(true)
    expect((await service.refresh({ projectId: 'cache-fixture', mode: 'combined' })).status).toBe('ready')
  })

  it('retains unchanged file slices while reparsing changed files', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'nodeterm-repository-graph-'))
    const userDataDir = await mkdtemp(join(tmpdir(), 'nodeterm-repository-graph-data-'))
    temporaryDirectories.push(projectRoot, userDataDir)
    await writeFile(join(projectRoot, 'one.ts'), 'export const first = 1\n')
    await writeFile(join(projectRoot, 'two.ts'), 'export const second = 2\n')
    const service = new RepositoryGraphService({ userDataDir, projectTargetInfo: () => ({ cwd: projectRoot, name: 'Incremental fixture' }) })
    await service.refresh({ projectId: 'incremental-fixture', mode: 'code' })
    await writeFile(join(projectRoot, 'one.ts'), 'export const changed = 3\n')
    const next = await service.refresh({ projectId: 'incremental-fixture', mode: 'code' })
    expect(next.status).toBe('ready')
    expect(next.nodes.some((node) => node.label === 'second')).toBe(true)
    expect(next.nodes.some((node) => node.label === 'changed')).toBe(true)
    expect(next.nodes.some((node) => node.label === 'first')).toBe(false)
  })

  it('parses npm shrinkwrap and neutralizes formula-looking spreadsheet cells in every export', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'nodeterm-repository-graph-'))
    const userDataDir = await mkdtemp(join(tmpdir(), 'nodeterm-repository-graph-data-'))
    temporaryDirectories.push(projectRoot, userDataDir)
    await writeFile(join(projectRoot, 'npm-shrinkwrap.json'), JSON.stringify({ packages: { '': {}, 'node_modules/=SUM(A1)': { version: '1.0.0' } } }))
    const service = new RepositoryGraphService({ userDataDir, projectTargetInfo: () => ({ cwd: projectRoot, name: 'Export fixture' }) })
    const snapshot = await service.refresh({ projectId: 'export-fixture', mode: 'dependencies' })
    expect(snapshot.status).toBe('ready')
    expect(snapshot.nodes.some((node) => node.label === '=SUM(A1)')).toBe(true)
    for (const format of ['json', 'jsonl', 'csv', 'tsv', 'markdown', 'html', 'graphml', 'dot'] as const) {
      const result = await service.export({ projectId: 'export-fixture', mode: 'dependencies', format })
      expect(result.content.length).toBeGreaterThan(0)
      expect(result.filename).toContain(format === 'markdown' ? '.md' : `.${format}`)
      if (format === 'csv' || format === 'tsv') expect(result.content).toContain("'=SUM(A1)")
    }
  })

  it('retains the prior snapshot when the elapsed-time bound is exceeded', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'nodeterm-repository-graph-'))
    const userDataDir = await mkdtemp(join(tmpdir(), 'nodeterm-repository-graph-data-'))
    temporaryDirectories.push(projectRoot, userDataDir)
    await mkdir(join(projectRoot, 'src'))
    await writeFile(join(projectRoot, 'src', 'index.ts'), 'export const value = 1\n')
    const service = new RepositoryGraphService({ maxDurationMs: 1, userDataDir, projectTargetInfo: () => ({ cwd: projectRoot, name: 'Deadline fixture' }) })
    const result = await service.refresh({ projectId: 'deadline-fixture', mode: 'code' })
    expect(result.status).toBe('failed')
    expect(result.omissions.some((item) => item.includes('exceeded 1ms'))).toBe(true)
  })
})
