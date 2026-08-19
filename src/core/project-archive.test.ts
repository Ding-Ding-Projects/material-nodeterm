import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Project } from '../shared/types'
import { LocalHistoryStore } from './local-history'
import { ProjectArchiveService } from './project-archive'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('single-file project archives', () => {
  it('round-trips the portable project and its app-owned Git history under a fresh identity', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nodeterm-project-archive-'))
    roots.push(root)
    const service = new ProjectArchiveService(new LocalHistoryStore(root))
    const project: Project = {
      id: 'original-project',
      name: 'History proof',
      color: '#6750a4',
      viewport: { x: 12, y: 34, zoom: 1.2 },
      nodes: []
    }

    const archive = await service.export(project)
    const imported = await service.import(archive)

    expect(imported.id).not.toBe(project.id)
    expect(imported.name).toBe(project.name)
    expect(imported.nodes).toEqual([])
    expect(JSON.parse(archive)).toMatchObject({
      schemaVersion: 1,
      history: { format: 'git-bundle-base64' }
    })
  })

  it('refuses an archive whose snapshot was changed outside the bundled history', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nodeterm-project-archive-'))
    roots.push(root)
    const service = new ProjectArchiveService(new LocalHistoryStore(root))
    const archive = JSON.parse(await service.export({
      id: 'p', name: 'Before', color: '#6750a4', viewport: { x: 0, y: 0, zoom: 1 }, nodes: []
    }))
    archive.project.name = 'Tampered'
    await expect(service.import(JSON.stringify(archive))).rejects.toThrow(/does not match/)
  })
})
