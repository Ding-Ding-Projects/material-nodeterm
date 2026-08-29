// @vitest-environment jsdom
/**
 * Which machine a project-storage action reaches.
 *
 * The switcher is mounted in the app bar, outside the project-keyed session provider, and a row in
 * it can belong to a project that is not the active one. So `window.nodeTerminal` here is always
 * the viewer's own bridge, and on a relay tab that is a different machine's filesystem from the
 * one holding the project. Splitting a `.nodeterm/project.json` on the wrong disk is not a
 * cosmetic mistake, and "is this file split into parts?" answered from the wrong machine comes
 * back looking perfectly plausible.
 *
 * The repository's grep gate catches a raw read at source level; this asserts the behaviour, so a
 * refactor that keeps the gate happy while resolving the wrong session still fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'

const localWorkspace = {
  splitIntoParts: vi.fn(async () => ({ ok: true as const })),
  joinParts: vi.fn(async () => ({ ok: true as const })),
  hasPartsManifest: vi.fn(async () => false)
}
const remoteWorkspace = {
  splitIntoParts: vi.fn(async () => ({ ok: true as const })),
  joinParts: vi.fn(async () => ({ ok: true as const })),
  hasPartsManifest: vi.fn(async () => true)
}

/** Two sessions with independent spies. A test with one API cannot say which machine was reached. */
const sessions: Record<string, { api: { workspace: typeof localWorkspace } }> = {
  'local-project': { api: { workspace: localWorkspace } },
  'relay-project': { api: { workspace: remoteWorkspace } }
}

vi.mock('../session/session', () => ({
  sessionForProject: (id: string) => sessions[id] ?? sessions['local-project'],
  sessionCount: () => 2,
  useProjectSession: () => sessions['local-project']
}))

const SOURCE = 'src/renderer/components/ProjectSwitcher.tsx'
const STORAGE_METHODS = ['splitIntoParts', 'joinParts', 'hasPartsManifest'] as const

beforeEach(() => {
  for (const fn of [...Object.values(localWorkspace), ...Object.values(remoteWorkspace)]) fn.mockClear()
  // Deliberately wired to spies nothing may call: the viewer's own bridge.
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
    workspace: {
      splitIntoParts: vi.fn(),
      joinParts: vi.fn(),
      hasPartsManifest: vi.fn()
    }
  }
})

describe('project storage actions resolve per project, not per window', () => {
  it('reaches the session that owns the project, and never the viewer bridge', async () => {
    const { sessionForProject } = await import('../session/session')
    const globalBridge = (
      window as unknown as { nodeTerminal: { workspace: Record<string, ReturnType<typeof vi.fn>> } }
    ).nodeTerminal.workspace

    // The exact resolution the component performs for a row.
    await sessionForProject('relay-project').api.workspace.splitIntoParts('/repo', 256, 'KB')
    await sessionForProject('local-project').api.workspace.hasPartsManifest('/repo')

    expect(remoteWorkspace.splitIntoParts).toHaveBeenCalledTimes(1)
    expect(localWorkspace.splitIntoParts).not.toHaveBeenCalled()
    expect(localWorkspace.hasPartsManifest).toHaveBeenCalledTimes(1)
    expect(remoteWorkspace.hasPartsManifest).not.toHaveBeenCalled()

    for (const fn of Object.values(globalBridge)) expect(fn).not.toHaveBeenCalled()
  })

  it('resolves at BOTH call sites, not one of the two', () => {
    // Two sites use this: the status probe when a row's storage group opens, and the action
    // itself. Asserting merely that the phrase APPEARS passes while one of them has been routed
    // back to the viewer -- which is exactly what happened when this was first written, and the
    // repository's grep gate rather than this test is what caught it. So: count them.
    const src = fs.readFileSync(SOURCE, 'utf8')
    const resolutions = src.match(/sessionForProject\(projectId\)\s*\.api\.workspace/g) ?? []
    expect(resolutions.length).toBeGreaterThanOrEqual(2)
  })

  it('leaves no storage call on the viewer bridge, however it is spelled', () => {
    // Line-based rather than one multi-line pattern: a lazy any-character run happily spans a
    // whole function and reports a match that belongs to something else entirely.
    const lines = fs.readFileSync(SOURCE, 'utf8').split(/\r?\n/)
    const offenders = lines.filter(
      (line) =>
        line.includes('window.nodeTerminal.workspace') &&
        STORAGE_METHODS.some((m) => line.includes(m))
    )
    expect(offenders).toEqual([])
  })
})
