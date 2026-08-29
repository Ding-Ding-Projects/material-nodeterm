// Integration proof that WorkspaceStore's read/save paths actually route through the parts
// storage encoding once a project is split — not just that project-parts.ts works in isolation.
// This is the dangerous seam: `.nodeterm/project.json` is the app's single source of truth, and a
// bug here is a bug that can silently drop a user's canvas.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { initPlatform, resetPlatformForTests } from './platform'
import { fakePlatform } from './platform-fake'
import { WorkspaceStore } from './workspace-store'
import type { Project, Workspace } from '../shared/types'
import {
  PARTS_SUBDIR,
  hasPartsManifest,
  manifestFilePath,
  partFilePath,
  readProjectParts
} from './project-parts'

let userData: string
let projRoot: string
let fake: ReturnType<typeof fakePlatform>

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'foo', color: '#7aa2f7', viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [{ id: 'term-1', kind: 'terminal', position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, title: 't', color: '#fff', group: null }],
  ...over
})
const ws = (projects: Project[], active = projects[0]?.id ?? ''): Workspace =>
  ({ version: 2, activeProjectId: active, projects })

beforeEach(async () => {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-ws-parts-'))
  projRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-proj-parts-'))
  fake = fakePlatform({ userDataDir: userData })
  initPlatform(fake)
})
afterEach(async () => {
  resetPlatformForTests()
  await fs.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  await fs.rm(projRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('splitProjectIntoParts / joinProjectParts', () => {
  it('splits a saved single-file project into parts, and the store keeps loading it correctly', async () => {
    const store = new WorkspaceStore()
    await store.save(ws([project({ cwd: projRoot })]))
    expect(await fs.readFile(path.join(projRoot, '.nodeterm/project.json'), 'utf-8')).toContain('"foo"')

    const result = await store.splitProjectIntoParts(projRoot, 64, 'KB')
    expect(result.ok).toBe(true)
    expect(await hasPartsManifest(projRoot)).toBe(true)
    // The classic single file is gone once the split is published.
    const singleExists = await fs
      .stat(path.join(projRoot, '.nodeterm/project.json'))
      .then(() => true)
      .catch(() => false)
    expect(singleExists).toBe(false)

    // A fresh store (simulating an app restart) must load the split project exactly as before.
    const reloaded = await new WorkspaceStore().load()
    expect(reloaded.projects[0]).toMatchObject({ id: 'p1', cwd: projRoot, name: 'foo' })
    expect(reloaded.projects[0].nodes[0].id).toBe('term-1')
  })

  it('a later save of a split project keeps writing parts, not a single file', async () => {
    const store = new WorkspaceStore()
    await store.save(ws([project({ cwd: projRoot })]))
    await store.splitProjectIntoParts(projRoot, 64, 'KB')

    // Load, mutate, save again — exactly what the real app does on every canvas edit.
    const loaded = await store.load()
    const mutated: Workspace = {
      ...loaded,
      projects: loaded.projects.map((p) =>
        p.id === 'p1'
          ? { ...p, nodes: [...p.nodes, { ...p.nodes[0], id: 'term-2', title: 'second node' }] }
          : p
      )
    }
    await store.save(mutated)

    expect(await hasPartsManifest(projRoot)).toBe(true)
    const singleExists = await fs
      .stat(path.join(projRoot, '.nodeterm/project.json'))
      .then(() => true)
      .catch(() => false)
    expect(singleExists).toBe(false)

    const read = await readProjectParts(projRoot)
    expect(read.ok).toBe(true)
    if (read.ok) {
      const parsed = JSON.parse(read.raw)
      expect(parsed.nodes).toHaveLength(2)
      expect(parsed.nodes[1].title).toBe('second node')
    }

    const reloaded = await new WorkspaceStore().load()
    expect(reloaded.projects[0].nodes.map((n) => n.id)).toEqual(['term-1', 'term-2'])
  })

  it('joins a split project back to a single file, and the store keeps loading it correctly', async () => {
    const store = new WorkspaceStore()
    await store.save(ws([project({ cwd: projRoot })]))
    await store.splitProjectIntoParts(projRoot, 64, 'KB')

    const joined = await store.joinProjectParts(projRoot)
    expect(joined.ok).toBe(true)
    expect(await hasPartsManifest(projRoot)).toBe(false)
    expect(await fs.readFile(path.join(projRoot, '.nodeterm/project.json'), 'utf-8')).toContain('"foo"')

    const reloaded = await new WorkspaceStore().load()
    expect(reloaded.projects[0]).toMatchObject({ id: 'p1', cwd: projRoot, name: 'foo' })
  })

  it('a save after every node is deleted from an already-split project is refused as unsafe by the same empty-guard as a single file', async () => {
    const store = new WorkspaceStore()
    await store.save(ws([project({ cwd: projRoot })]))
    await store.splitProjectIntoParts(projRoot, 64, 'KB')

    // A fresh store that never actually READ this project (simulating a race/migration) must not
    // blind-write an empty canvas over a populated split project.
    const fresh = new WorkspaceStore()
    await fresh.save(ws([project({ cwd: projRoot, nodes: [] })]))

    const read = await readProjectParts(projRoot)
    expect(read.ok).toBe(true)
    if (read.ok) expect(JSON.parse(read.raw).nodes).toHaveLength(1) // untouched — still the original node
  })
})

describe('a corrupted split project becomes unavailable, never silently emptied', () => {
  it('a project whose parts fail verification is not returned by load(), and the manifest is sidelined rather than destroyed', async () => {
    const store = new WorkspaceStore()
    await store.save(ws([project({ cwd: projRoot })]))
    await store.splitProjectIntoParts(projRoot, 64, 'KB')

    // Corrupt one part directly on disk, exactly as a bad git merge or manual edit could.
    const read = await readProjectParts(projRoot)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    const victim = read.manifest.parts[0]
    await fs.rm(partFilePath(projRoot, read.manifest, victim.name))

    const fresh = new WorkspaceStore()
    const loaded = await fresh.load()
    const entry = loaded.projects.find((p) => p.cwd === projRoot)
    // Same contract as an unreadable single project.json: the project comes back marked
    // unavailable (a greyed, still-present tab) rather than vanishing or silently loading empty.
    expect(entry?.unavailable).toBe(true)

    // The manifest is sidelined (renamed, not deleted) so the broken parts remain recoverable —
    // and so a LATER save can never publish a fresh manifest that quietly resumes on top of it.
    const manifestGone = await fs.stat(manifestFilePath(projRoot)).then(() => true).catch(() => false)
    expect(manifestGone).toBe(false)
    const dir = await fs.readdir(path.join(projRoot, '.nodeterm'))
    expect(dir.some((f) => f.startsWith('project.parts.json.corrupt-'))).toBe(true)
    // The parts themselves (including the surviving, unharmed ones) are left exactly as found —
    // sideline never touches them, only the manifest that pointed at them.
    const partsRootStillPresent = await fs
      .stat(path.join(projRoot, '.nodeterm', PARTS_SUBDIR))
      .then(() => true)
      .catch(() => false)
    expect(partsRootStillPresent).toBe(true)
  })
})

describe('rejects an unsafe or nonexistent split/join', () => {
  it('splitProjectIntoParts on a folder with no project file at all fails cleanly', async () => {
    const store = new WorkspaceStore()
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'nt-empty-'))
    try {
      const result = await store.splitProjectIntoParts(empty, 64, 'KB')
      expect(result.ok).toBe(false)
    } finally {
      await fs.rm(empty, { recursive: true, force: true })
    }
  })

  it('joinProjectParts on a project that was never split is refused rather than doing nothing quietly', async () => {
    const store = new WorkspaceStore()
    await store.save(ws([project({ cwd: projRoot })]))
    const result = await store.joinProjectParts(projRoot)
    expect(result.ok).toBe(false)
  })
})
