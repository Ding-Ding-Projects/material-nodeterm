// @vitest-environment jsdom
/**
 * Behavioral suite for the per-element appearance editor (docs/appearance.md). Until this file
 * existed only the logo leg had a test (`logoSelection.test.ts`); the editor itself — the thing
 * the contract row in scripts/check-app-contract.mjs asserts is *wired* — had no proof it
 * *behaves*.
 *
 * Contract clauses covered, in the brief's words:
 *  - settings persist PER ELEMENT ................. independent-entries + write-through tests
 *  - reset per PROPERTY, per ELEMENT, and GLOBAL .. the three reset tests (global reset leaves
 *    the preset library untouched, per docs/appearance.md)
 *  - an unrepresentable value is never silently
 *    dropped — the app SAYS SO and KEEPS the input . missing-font note, variable-axes note, and
 *    the one-decoration-channel limitation tests
 *  - `data-appearance-id` is load-bearing ......... Canvas.tsx anchors the editor by QUERYING
 *    that attribute, and users' saved rules in settings.json are keyed to those ids — so the id
 *    FORMAT (`kind:key`), the five app-chrome literals, and both halves of the node id contract
 *    (TerminalNode SETS it, Canvas QUERIES it) are pinned here. Renaming any of them silently
 *    stops a user's saved customisation applying, which is exactly the failure these guards
 *    exist to catch.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '@shared/types'
import { useSettings } from '@renderer/state/settings'
import { openAppearanceEditor, useAppearanceEditorHost } from '@renderer/state/appearanceEditorHost'
import { resetAllElements, setElementStyle } from '@renderer/state/appearance'
import { appearanceId, APP_CHROME_TARGETS } from '@renderer/lib/appearance/registry'
import { resolveEffectiveStyle, styleToCssProperties } from '@renderer/lib/appearance/apply'
import { AppearanceEditorHost } from './AppearanceEditor'
import { AppearanceStyleInjector } from './AppearanceStyleInjector'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Vitest runs with cwd at the repo root; under this project's jsdom setup `import.meta.url` is
// not a file: URL, so the source-scan guard anchors on cwd and verifies it before trusting it.
const REPO_ROOT = process.cwd()
if (!existsSync(resolve(REPO_ROOT, 'src/renderer/canvas/Canvas.tsx'))) {
  throw new Error(`source-scan guard: cwd is not the repo root (${REPO_ROOT})`)
}

let host: HTMLDivElement
let root: Root
let anchor: HTMLButtonElement

function q<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`expected element for selector: ${selector}`)
  return el
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === text)
  if (!btn) throw new Error(`expected a button with text: ${text}`)
  return btn
}

function click(el: Element): void {
  act(() => {
    ;(el as HTMLElement).click()
  })
}

function setSelect(el: HTMLSelectElement, value: string): void {
  act(() => {
    el.value = value
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function setTextInput(el: HTMLInputElement, value: string): void {
  act(() => {
    // Bypass React's instance-level value tracker (a direct `.value =` updates the tracker too,
    // so the input event is deduped as "no change" and the controlled onChange never fires).
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function openEditor(id: string, label = 'Test element', kind = 'node'): void {
  act(() => {
    openAppearanceEditor(id, label, kind, anchor)
  })
}

function switchTab(label: string): void {
  const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((t) => t.textContent === label)
  if (!tab) throw new Error(`expected a tab labelled: ${label}`)
  click(tab)
}

function entries(): Record<string, { style: Record<string, unknown>; inheritFrom?: string; label: string; kind: string }> {
  return useSettings.getState().settings.elementAppearance as never
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  )
  // The settings store's coalesced save reaches window.nodeTerminal.settings.save ~300 ms after
  // an update; in jsdom nothing provides the bridge, so stub the one method the store calls.
  ;(window as unknown as { nodeTerminal: unknown }).nodeTerminal = {
    settings: { save: vi.fn(async () => {}) }
  }
  // jsdom has no 2D canvas: stub a measurer whose widths never vary, so `createCanvasMeasurer`
  // is non-null and EVERY non-generic family measures as "not installed" — which is exactly the
  // state the missing-font disclosure exists for.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: () => ({ width: 100 })
  } as unknown as CanvasRenderingContext2D)

  useSettings.setState({
    base: { ...DEFAULT_SETTINGS, elementAppearance: {}, appearancePresets: [] },
    settings: { ...DEFAULT_SETTINGS, elementAppearance: {}, appearancePresets: [] },
    hydrated: true,
    scope: 'global',
    activeProjectId: '',
    projectOverrides: {}
  })
  useAppearanceEditorHost.setState({ target: null })

  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  anchor = document.createElement('button')
  anchor.textContent = 'anchor'
  document.body.appendChild(anchor)
  act(() => {
    root.render(<AppearanceEditorHost />)
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  anchor.remove()
  useAppearanceEditorHost.setState({ target: null })
  document.querySelectorAll('.appearance-editor').forEach((el) => el.remove())
  document.getElementById('nodeterm-appearance-overrides')?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------------------------
// The load-bearing ids: format stability + both halves of every attribute contract
// ---------------------------------------------------------------------------------------------

describe('data-appearance-id stability', () => {
  it('appearanceId keeps the persisted `kind:key` format users’ saved rules are keyed to', () => {
    // settings.json holds elementAppearance keyed by exactly these strings. Changing the format
    // orphans every saved rule silently — the customisation just stops applying, with no error.
    expect(appearanceId('node', 'abc')).toBe('node:abc')
    expect(appearanceId('tab', 'p1')).toBe('tab:p1')
    expect(appearanceId('app', 'context-menu')).toBe('app:context-menu')
  })

  it('the five app-chrome ids are exactly the documented literals', () => {
    expect(APP_CHROME_TARGETS.map((t) => t.id)).toEqual([
      'app:tabbar-brand',
      'app:context-menu',
      'app:settings-dialog',
      'app:appearance-editor',
      'app:command-palette'
    ])
  })

  it('every app-chrome id is actually carried by its component, and the node id contract has both halves', () => {
    // Source-anchored guard: docs/appearance.md promises each chrome target carries the
    // attribute on its real rendered root, and Canvas.tsx anchors the node editor by QUERYING
    // the attribute TerminalNode.tsx SETS. Files are CRLF on Windows checkouts — normalize
    // before scanning, and strip comments so a commented-out attribute cannot satisfy the guard.
    const read = (rel: string): string =>
      readFileSync(resolve(REPO_ROOT, rel), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')

    const chrome: Record<string, string> = {
      'src/renderer/components/TopAppBar.tsx': 'data-appearance-id="app:tabbar-brand"',
      'src/renderer/components/ContextMenu.tsx': 'data-appearance-id="app:context-menu"',
      'src/renderer/components/settings/SettingsPage.tsx': 'data-appearance-id="app:settings-dialog"',
      'src/renderer/components/appearance/AppearanceEditor.tsx': 'data-appearance-id="app:appearance-editor"',
      'src/renderer/components/CommandPalette.tsx': 'data-appearance-id="app:command-palette"'
    }
    for (const [file, needle] of Object.entries(chrome)) {
      expect(read(file), `${file} must carry ${needle}`).toContain(needle)
    }

    // The node contract: the attribute the node header SETS…
    expect(read('src/renderer/nodes/TerminalNode.tsx')).toContain(
      "data-appearance-id={appearanceId('node', id)}"
    )
    // …is the attribute Canvas QUERIES to anchor the editor, through the same builder.
    const canvas = read('src/renderer/canvas/Canvas.tsx')
    expect(canvas).toContain('[data-appearance-id="${appearanceId(\'node\', ids[0])}"]')
  })

  it('the editor’s own dialog carries app:appearance-editor at runtime (self-theming, behaviorally)', () => {
    openEditor('node:n1', 'My node')
    const dialog = q<HTMLElement>('[role="dialog"].appearance-editor')
    expect(dialog.getAttribute('data-appearance-id')).toBe('app:appearance-editor')
    expect(dialog.getAttribute('aria-label')).toBe('Edit appearance — My node')
  })
})

// ---------------------------------------------------------------------------------------------
// Editing, per-element persistence, and the three reset granularities
// ---------------------------------------------------------------------------------------------

describe('editing and persistence', () => {
  it('opening and closing without edits leaves elementAppearance exactly as it was', () => {
    openEditor('node:n1')
    click(q('.appearance-editor__close'))
    expect(entries()).toEqual({})
  })

  it('an edit writes a per-element entry, and two elements persist independently', () => {
    openEditor('node:n1', 'Node one')
    setSelect(q<HTMLSelectElement>('select[aria-label="Font weight"]'), '700')
    expect(entries()['node:n1'].style.fontWeight).toBe(700)
    expect(entries()['node:n1'].label).toBe('Node one')
    expect(entries()['node:n1'].kind).toBe('node')

    openEditor('node:n2', 'Node two')
    setSelect(q<HTMLSelectElement>('select[aria-label="Font weight"]'), '300')
    expect(entries()['node:n1'].style.fontWeight).toBe(700)
    expect(entries()['node:n2'].style.fontWeight).toBe(300)
  })

  it('reset per PROPERTY removes only that property and leaves the rest of the element alone', () => {
    openEditor('node:n1')
    setSelect(q<HTMLSelectElement>('select[aria-label="Font weight"]'), '700')
    setTextInput(q<HTMLInputElement>('input[aria-label="Font size (px)"]'), '20')
    expect(entries()['node:n1'].style).toMatchObject({ fontWeight: 700, fontSizePx: 20 })

    click(q('button[aria-label="Reset Weight"]'))
    expect(entries()['node:n1'].style.fontWeight).toBeUndefined()
    expect(entries()['node:n1'].style.fontSizePx).toBe(20)
  })

  it('resetting the LAST property drops the entry entirely — no residue in settings.json', () => {
    openEditor('node:n1')
    setSelect(q<HTMLSelectElement>('select[aria-label="Font weight"]'), '700')
    click(q('button[aria-label="Reset Weight"]'))
    expect(entries()['node:n1']).toBeUndefined()
  })

  it('reset per ELEMENT needs the two-step confirm and then drops the whole entry', () => {
    openEditor('node:n1')
    setSelect(q<HTMLSelectElement>('select[aria-label="Font weight"]'), '700')
    switchTab('Presets')
    click(buttonByText('Reset this element'))
    // First click only arms — nothing deleted yet.
    expect(entries()['node:n1']).toBeDefined()
    click(buttonByText('Click again to confirm'))
    expect(entries()['node:n1']).toBeUndefined()
  })

  it('GLOBAL reset clears every element but leaves the preset library untouched', () => {
    // The global-reset button lives in Settings → Appearance; the action it calls is
    // `resetAllElements`, asserted here at the state layer the button is wired to.
    openEditor('node:n1')
    setSelect(q<HTMLSelectElement>('select[aria-label="Font weight"]'), '700')
    switchTab('Presets')
    setTextInput(q<HTMLInputElement>('input[aria-label="New preset name"]'), 'Bold look')
    click(buttonByText('Save'))
    expect(useSettings.getState().settings.appearancePresets).toHaveLength(1)

    act(() => resetAllElements())
    expect(entries()).toEqual({})
    expect(useSettings.getState().settings.appearancePresets).toHaveLength(1)
    expect(useSettings.getState().settings.appearancePresets[0]).toMatchObject({
      name: 'Bold look',
      style: { fontWeight: 700 }
    })
  })

  it('a saved preset can be applied to a different element', () => {
    openEditor('node:n1')
    setSelect(q<HTMLSelectElement>('select[aria-label="Font weight"]'), '700')
    switchTab('Presets')
    setTextInput(q<HTMLInputElement>('input[aria-label="New preset name"]'), 'Bold look')
    click(buttonByText('Save'))

    openEditor('node:n2', 'Node two')
    switchTab('Presets')
    click(buttonByText('Apply'))
    expect(entries()['node:n2'].style.fontWeight).toBe(700)
  })

  it('inherit-from persists and resolves one hop for properties the element leaves unset', () => {
    act(() => setElementStyle('node:other', 'Other node', 'node', { color: '#ff0000' }))
    openEditor('node:n1')
    setSelect(q<HTMLSelectElement>('select[aria-label="Font weight"]'), '700')
    switchTab('Presets')
    setSelect(q<HTMLSelectElement>('select[aria-label="Inherit unset properties from"]'), 'node:other')
    expect(entries()['node:n1'].inheritFrom).toBe('node:other')
    const effective = resolveEffectiveStyle('node:n1', entries() as never)
    expect(effective).toMatchObject({ fontWeight: 700, color: '#ff0000' })
  })

  it('a persisted entry is APPLIED to the DOM via the generated [data-appearance-id] stylesheet', () => {
    act(() => {
      root.render(
        <>
          <AppearanceEditorHost />
          <AppearanceStyleInjector />
        </>
      )
    })
    act(() => setElementStyle('node:n1', 'Node one', 'node', { color: '#ff0000' }))
    const sheet = document.getElementById('nodeterm-appearance-overrides')
    expect(sheet).not.toBeNull()
    // CSS.escape may write the id's colon as \: — both spellings address the same attribute.
    expect(sheet!.textContent).toMatch(/\[data-appearance-id="node\\?:n1"\]/)
    expect(sheet!.textContent).toContain('color: #ff0000 !important;')
  })
})

// ---------------------------------------------------------------------------------------------
// Unrepresentable values: said out loud, never silently dropped
// ---------------------------------------------------------------------------------------------

describe('unrepresentable values are kept and disclosed', () => {
  it('a font that is not installed keeps the typed value and says so beside the field', () => {
    openEditor('node:n1')
    setTextInput(q<HTMLInputElement>('input[aria-label="Font family (CSS stack)"]'), 'Definitely Not A Font')
    // Kept, not dropped:
    expect(entries()['node:n1'].style.fontFamily).toBe('Definitely Not A Font')
    // And said:
    const note = Array.from(document.querySelectorAll('.appearance-editor__note')).find((n) =>
      n.textContent?.includes('isn’t installed on this machine')
    )
    expect(note, 'expected the missing-font disclosure note').toBeTruthy()
    expect(note!.textContent).toContain('The value is kept')
  })

  it('a variable-font axis value is stored even when no font/platform honours it, and the copy says values are kept', () => {
    openEditor('node:n1')
    click(q('.appearance-editor__disclosure'))
    setTextInput(q<HTMLInputElement>('input[aria-label="Font axis wght"]'), '625')
    expect((entries()['node:n1'].style.fontAxes as Record<string, number>).wght).toBe(625)
    const noteText = Array.from(document.querySelectorAll('.appearance-editor__note'))
      .map((n) => n.textContent ?? '')
      .join('\n')
    expect(noteText).toContain('your value is kept either way')
  })

  it('underline+strikethrough are both STORED individually while CSS can only render one decoration style, and the editor says so', () => {
    openEditor('node:n1')
    switchTab('Colour & effects')
    setSelect(q<HTMLSelectElement>('select[aria-label="Underline style"]'), 'wavy')
    setSelect(q<HTMLSelectElement>('select[aria-label="Strikethrough"]'), 'double')
    // Both individual choices persist…
    expect(entries()['node:n1'].style).toMatchObject({ underline: 'wavy', strikethrough: 'double' })
    // …the rendering limitation is real (one shared style channel; the underline's wins)…
    const css = styleToCssProperties(entries()['node:n1'].style as never)
    expect(css['text-decoration-line']).toBe('underline line-through')
    expect(css['text-decoration-style']).toBe('wavy')
    // …and the editor discloses it rather than silently normalising the stored values.
    const noteText = Array.from(document.querySelectorAll('.appearance-editor__note'))
      .map((n) => n.textContent ?? '')
      .join('\n')
    expect(noteText).toContain('ONE style/colour for underline, overline and strikethrough')
    expect(noteText).toContain('still stored and reapplied individually')
  })
})

// ---------------------------------------------------------------------------------------------
// Popover contract: focus return and Escape
// ---------------------------------------------------------------------------------------------

describe('popover behaviour', () => {
  it('closing returns keyboard focus to the anchor that opened it', () => {
    openEditor('node:n1')
    expect(document.querySelector('.appearance-editor')).not.toBeNull()
    click(q('.appearance-editor__close'))
    expect(document.querySelector('.appearance-editor')).toBeNull()
    expect(document.activeElement).toBe(anchor)
  })

  it('Escape closes the editor', () => {
    openEditor('node:n1')
    act(() => {
      q('.appearance-editor').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(document.querySelector('.appearance-editor')).toBeNull()
    expect(document.activeElement).toBe(anchor)
  })
})
