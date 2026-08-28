// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ContextMenu, mapAuthoredMenuItems, type MenuItem } from './ContextMenu'
import { ExportMenu } from './ExportMenu'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class NoopResizeObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  document.body.replaceChildren()
  root = undefined
  host = undefined
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0 })
  useSchoolMode.setState({ enabled: false, hydrated: false })
})

describe('Chrome controls personal vocabulary boundaries', () => {
  it('maps authored menu prose while preserving factual labels and hints', () => {
    const items: MenuItem[] = [
      { label: 'Open terminal', hint: 'Choose an action', vocabularyMode: 'authored', onClick: () => {} },
      { label: 'C:/workspace/terminal', hint: 'fatal: terminal not found', onClick: () => {} },
      {
        type: 'submenu',
        label: 'Terminal actions',
        vocabularyMode: 'authored',
        children: [
          { label: 'Run terminal', vocabularyMode: 'authored', onClick: () => {} },
          { label: 'origin/main', onClick: () => {} }
        ]
      },
      { type: 'label', label: 'Terminal section', vocabularyMode: 'authored' }
    ]
    const mapper = <T extends string | undefined | null>(value: T): T =>
      (typeof value === 'string' ? value.replaceAll('terminal', 'shell box') : value) as T
    const mapped = mapAuthoredMenuItems(items, mapper)

    expect(mapped[0]).toMatchObject({ label: 'Open shell box', hint: 'Choose an action' })
    expect(mapped[1]).toMatchObject({ label: 'C:/workspace/terminal', hint: 'fatal: terminal not found' })
    const submenu = mapped[2] as Extract<MenuItem, { type: 'submenu' }>
    expect(submenu.label).toBe('Terminal actions')
    expect(submenu.children[0]).toMatchObject({ label: 'Run shell box' })
    expect(submenu.children[1]).toMatchObject({ label: 'origin/main' })
    expect(mapped[3]).toMatchObject({ label: 'Terminal section' })
  })

  it('renders translated export controls and keeps the saved path exact', async () => {
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: NoopResizeObserver })
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { Export: 'Send out', Format: 'Shape', Save: 'Write it', 'Saved to ': 'Filed at ' },
      entryCount: 4
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    ;(window as unknown as { nodeTerminal: any }).nodeTerminal = {
      export: {
        saveText: async () => ({ ok: true, path: 'C:/workspace/terminal/export.json' })
      },
      vscode: { open: async () => ({ ok: true }) }
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        <ExportMenu
          kind="structured"
          label="terminal"
          build={() => ({
            filename: 'export.json',
            content: '{}',
            mimeType: 'application/json',
            encoding: 'utf-8',
            lineEnding: 'LF',
            lossy: []
          })}
        />
      )
    })
    const toggle = host.querySelector<HTMLButtonElement>('.export-menu__toggle')
    expect(toggle?.textContent).toBe('Send out…')
    await act(async () => toggle?.click())
    expect(host.querySelector('.export-menu__format-label')?.textContent).toContain('Shape')
    const save = host.querySelector<HTMLButtonElement>('.export-menu__save')
    await act(async () => save?.click())
    expect(host.querySelector('.export-menu__result')?.textContent).toContain('C:/workspace/terminal/export.json')
    expect(host.querySelector('.export-menu__result')?.textContent).toContain('Filed at')
  })

  it('maps only explicitly authored direct ContextMenu rows and leaves the factual row untouched', async () => {
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: NoopResizeObserver })
    usePersonalVocabulary.setState({ status: 'loaded', entries: { terminal: 'shell box' }, entryCount: 1 })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        <ContextMenu
          x={10}
          y={10}
          items={[
            { label: 'Open terminal', vocabularyMode: 'authored', onClick: () => {} },
            { label: 'C:/workspace/terminal', onClick: () => {} }
          ]}
          onClose={() => {}}
        />
      )
    })
    const labels = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((el) => el.textContent?.trim())
    expect(labels).toContain('Open shell box')
    expect(labels).toContain('C:/workspace/terminal')

    act(() => useSchoolMode.setState({ enabled: true, hydrated: true }))
    const schoolLabels = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((el) => el.textContent?.trim())
    expect(schoolLabels).toContain('Open terminal')
    expect(schoolLabels).toContain('C:/workspace/terminal')
  })
})
