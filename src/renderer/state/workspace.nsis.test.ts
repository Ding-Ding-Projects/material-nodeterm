import { describe, expect, it } from 'vitest'
import { createNsisNode, flowToNodeStates, nodeStatesToFlow } from './workspace'
import { stripSharedNodeExec } from '@shared/node-exec'
import { defaultNsisSpec } from '@shared/nsis-form-types'

describe('NSIS installer node', () => {
  it('creates a canvas object with real spec defaults and no local paths yet', () => {
    const node = createNsisNode(0, { x: 100, y: 100 })
    expect(node.type).toBe('nsis')
    expect(node.data.nsisSpec).toEqual(defaultNsisSpec())
    expect(node.data.nsisLocalPaths).toEqual({ sourcePaths: [] })
  })

  it('round-trips the git-shared spec through flowToNodeStates/nodeStatesToFlow', () => {
    const node = createNsisNode(0)
    node.data = {
      ...node.data,
      nsisSpec: {
        ...defaultNsisSpec(),
        appName: 'Widgetizer',
        version: '2.3.4',
        publisher: 'Acme Corp'
      }
    }

    const [saved] = flowToNodeStates([node])
    expect(saved.kind).toBe('nsis')
    expect(saved.nsisSpec?.appName).toBe('Widgetizer')

    const [loaded] = nodeStatesToFlow([saved])
    expect(loaded.type).toBe('nsis')
    expect(loaded.data.nsisSpec).toEqual(saved.nsisSpec)
  })

  /**
   * The load-bearing assertion: `nsisLocalPaths` carries absolute paths on THIS machine (see
   * `@shared/nsis-form-types`'s file header and `@shared/node-exec`'s doc comment). It must never
   * reach `.nodeterm/project.json` — the git-shared, hand-editable, auto-adopted-by-"Open folder…"
   * document that every other clone of the repo reads. `flowToNodeStates` legitimately keeps it
   * (that is the machine-local *renderer* state, mirrored into `workspace.json`'s index), but the
   * moment those states cross into the SHARED document — `stripSharedNodeExec`, the exact function
   * `core/workspace-files.ts`'s `projectToFile` calls before writing `.nodeterm/project.json` — the
   * absolute paths must be gone.
   */
  it('strips absolute local source/license/icon paths before they reach the shared project file', () => {
    const node = createNsisNode(0)
    node.data = {
      ...node.data,
      nsisLocalPaths: {
        sourcePaths: ['C:\\Users\\alice\\Desktop\\MyApp\\dist', 'C:\\Users\\alice\\Desktop\\MyApp\\readme.txt'],
        licensePath: 'C:\\Users\\alice\\Desktop\\MyApp\\LICENSE.txt',
        iconPath: 'C:\\Users\\alice\\Desktop\\MyApp\\app.ico'
      }
    }

    const [saved] = flowToNodeStates([node])
    // Sanity: the renderer/machine-local layer really did carry it this far.
    expect(saved.nsisLocalPaths?.sourcePaths).toContain('C:\\Users\\alice\\Desktop\\MyApp\\dist')

    const [shared] = stripSharedNodeExec([saved])
    expect(shared.nsisLocalPaths).toBeUndefined()
    // The git-shared half survives untouched — only the machine-local half is stripped.
    expect(shared.nsisSpec).toEqual(saved.nsisSpec)
  })
})
