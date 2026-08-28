import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  SHARED_PROJECT_ACTIONS,
  SAVE_PROJECT_ARCHIVE_ACTION,
  OPEN_PROJECT_ARCHIVE_ACTION,
  EDIT_TAB_APPEARANCE_ACTION
} from './projectMenuActions'

const here = path.dirname(fileURLToPath(import.meta.url))
const canvasSrc = readFileSync(path.join(here, '../canvas/Canvas.tsx'), 'utf8')
const switcherSrc = readFileSync(path.join(here, '../components/ProjectSwitcher.tsx'), 'utf8')

describe('sharedProjectMenuActions', () => {
  it('yields exactly the archive actions and the appearance action', () => {
    expect(SHARED_PROJECT_ACTIONS.map((a) => a.id)).toEqual(['save-archive', 'open-archive', 'edit-appearance'])
    expect(SAVE_PROJECT_ARCHIVE_ACTION.label).toBe('Save project as one file…')
    expect(OPEN_PROJECT_ARCHIVE_ACTION.label).toBe('Open project from file…')
    expect(EDIT_TAB_APPEARANCE_ACTION.label).toBe('Edit tab appearance…')
  })

  it('has no duplicate ids or labels — a copy-paste second definition would silently drift', () => {
    const ids = SHARED_PROJECT_ACTIONS.map((a) => a.id)
    const labels = SHARED_PROJECT_ACTIONS.map((a) => a.label)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(labels).size).toBe(labels.length)
  })

  // The regression this whole change fixes: two independently-typed project menus that drifted
  // apart. Reading the raw source (rather than deep-rendering two very differently-shaped React
  // trees) proves the thing that actually matters — that both files import from the ONE shared
  // module rather than re-typing the label — without needing a full Canvas.tsx render harness.
  it('both the sidebar menu (Canvas.tsx) and the project switcher import the shared module', () => {
    expect(canvasSrc).toMatch(/from ['"]\.\.\/lib\/projectMenuActions['"]/)
    expect(switcherSrc).toMatch(/from ['"]\.\.\/lib\/projectMenuActions['"]/)
  })

  it('the sidebar menu (Canvas.tsx) renders the archive actions and the appearance action', () => {
    expect(canvasSrc).toMatch(/label:\s*SAVE_PROJECT_ARCHIVE_ACTION\.label/)
    expect(canvasSrc).toMatch(/label:\s*OPEN_PROJECT_ARCHIVE_ACTION\.label/)
    expect(canvasSrc).toMatch(/label:\s*EDIT_TAB_APPEARANCE_ACTION\.label/)
  })

  it('the project switcher renders the archive actions and the appearance action', () => {
    expect(switcherSrc).toMatch(/vocab\(SAVE_PROJECT_ARCHIVE_ACTION\.label\)/)
    expect(switcherSrc).toMatch(/vocab\(OPEN_PROJECT_ARCHIVE_ACTION\.label\)/)
    expect(switcherSrc).toMatch(/vocab\(EDIT_TAB_APPEARANCE_ACTION\.label\)/)
  })
})
