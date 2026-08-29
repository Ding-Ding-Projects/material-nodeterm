import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
})
