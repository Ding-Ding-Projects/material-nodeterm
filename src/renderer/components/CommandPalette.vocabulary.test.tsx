// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/dom'
import { CommandPalette, type Command } from './CommandPalette'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import { prepareQuickOpenFiles } from '../lib/quickOpenSearch'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0 })
  useSchoolMode.setState({ enabled: false, hydrated: false })
  vi.unstubAllGlobals()
})

function loadVocabulary(): void {
  usePersonalVocabulary.setState({
    status: 'loaded',
    entries: { terminal: 'shell box' },
    entryCount: 1
  })
  // The substitution is an optional School-mode feature: it may run only after a read proved the
  // shared mode is OFF, so a test that forgets `hydrated` is testing the suppressed path.
  useSchoolMode.setState({ enabled: false, hydrated: true })
}

function render(props: {
  commands: Command[]
  extraCommands?: Command[]
  fileIndex?: ReturnType<typeof prepareQuickOpenFiles>
  onOpenFile?: (relPath: string) => void
  onRevealFile?: (relPath: string) => void
}): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root?.render(
      <CommandPalette
        commands={props.commands}
        extraCommands={props.extraCommands}
        fileIndex={props.fileIndex}
        onOpenFile={props.onOpenFile}
        onRevealFile={props.onRevealFile}
        onClose={() => {}}
      />
    )
  )
}

function type(q: string): void {
  const input = document.body.querySelector<HTMLInputElement>('.palette__input')
  act(() => {
    if (!input) throw new Error('no palette input')
    fireEvent.change(input, { target: { value: q } })
  })
}

function rowText(): string {
  return [...document.body.querySelectorAll('.palette__item')].map((e) => e.textContent).join('|')
}

describe('CommandPalette personal vocabulary', () => {
  it('replaces command prose and lets the user search for the words they can see', () => {
    loadVocabulary()
    render({
      commands: [
        { id: 'new-term', label: 'New terminal', section: 'Create terminal', run: () => {} }
      ]
    })
    expect(rowText()).toContain('New shell box')

    // The substitution must run BEFORE the filter: a row rendered as "New shell box" that only
    // answers a search for "terminal" is a visible row the user cannot type for.
    type('shell box')
    expect(rowText()).toContain('New shell box')
  })

  it('leaves transcript hits (extraCommands) verbatim', () => {
    // `extraCommands` are conversation hits: the label is the transcript's own text, i.e. quoted
    // output, and the palette documents them as appended verbatim.
    loadVocabulary()
    render({
      commands: [],
      extraCommands: [
        { id: 'transcript:1', label: 'open the terminal for me', section: 'Conversations', run: () => {} }
      ]
    })
    expect(rowText()).toContain('open the terminal for me')
  })

  it('omits every personal-vocabulary command while School mode is on, and while it is still unknown', () => {
    loadVocabulary()
    useSchoolMode.setState({ enabled: true, hydrated: true })
    render({
      commands: [
        { id: 'open-personal-vocabulary', label: 'Upload personal vocabulary file', run: () => {} },
        { id: 'personal-vocabulary-status', label: 'Personal vocabulary status', run: () => {} },
        { id: 'clear-personal-vocabulary', label: 'Clear personal vocabulary', run: () => {} }
      ]
    })
    expect(rowText()).toBe('')
    expect(document.querySelector('.palette__empty')?.textContent).toBe('No matches')
    act(() => root?.unmount())
    host?.remove()

    // Pre-hydration `enabled: false` is a placeholder, not a confirmed-off record.
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { terminal: 'shell box' },
      entryCount: 1
    })
    useSchoolMode.setState({ enabled: false, hydrated: false })
    render({
      commands: [
        { id: 'open-personal-vocabulary', label: 'Upload personal vocabulary file', run: () => {} },
        { id: 'personal-vocabulary-status', label: 'Personal vocabulary status', run: () => {} },
        { id: 'clear-personal-vocabulary', label: 'Clear personal vocabulary', run: () => {} }
      ]
    })
    expect(rowText()).toBe('')
    expect(document.querySelector('.palette__empty')?.textContent).toBe('No matches')
    act(() => root?.unmount())
    host?.remove()
    useSchoolMode.setState({ enabled: false, hydrated: true })
    render({
      commands: [
        { id: 'open-personal-vocabulary', label: 'Upload personal vocabulary file', run: () => {} },
        { id: 'personal-vocabulary-status', label: 'Personal vocabulary status', run: () => {} },
        { id: 'clear-personal-vocabulary', label: 'Clear personal vocabulary', run: () => {} }
      ]
    })
    expect(rowText()).toContain('Upload personal vocabulary file')
    expect(rowText()).toContain('Personal vocabulary status')
    expect(rowText()).toContain('Clear personal vocabulary')
  })

  it('shows the shipped wording when no file has been uploaded', () => {
    useSchoolMode.setState({ enabled: false, hydrated: true })
    render({ commands: [{ id: 'a', label: 'New terminal', run: () => {} }] })
    expect(rowText()).toContain('New terminal')
  })

  it('maps palette-owned copy and file actions while preserving output and file facts', () => {
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: {
        'Type a command or name…': 'Find something…',
        'Expand to full window': 'Open wide',
        'No matches': 'Nothing found',
        'found in output': 'Output clue',
        'Click to change': 'Change value',
        Files: 'Local files',
        'Reveal in Explorer': 'Show containing folder'
      },
      entryCount: 7
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        private readonly callback: (entries: Array<{ isIntersecting: boolean }>) => void
        constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
          this.callback = callback
        }
        observe(): void {
          this.callback([{ isIntersecting: true }])
        }
        disconnect(): void {}
      }
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        disconnect(): void {}
      }
    )

    render({
      commands: [
        {
          id: 'inline-setting',
          label: 'Inline setting',
          control: {
            type: 'select',
            value: 'one',
            options: [{ value: 'one', label: 'One' }],
            onChange: () => {}
          },
          run: () => {}
        },
        { id: 'output-hit', label: 'Other row', content: 'terminal output fact', run: () => {} }
      ],
      fileIndex: prepareQuickOpenFiles(['src/renderer/components/CommandPalette.tsx']),
      onOpenFile: () => {},
      onRevealFile: () => {}
    })

    const input = document.body.querySelector<HTMLInputElement>('.palette__input')
    expect(input?.placeholder).toBe('Find something…')
    expect(document.querySelector<HTMLButtonElement>('.palette__size-toggle')?.title).toBe('Open wide')
    expect(document.querySelector('[role="button"]')?.getAttribute('title')).toBe('Change value')

    type('terminal')
    expect(rowText()).toContain('Output clue')
    expect(rowText()).toContain('Other row')

    act(() => root?.unmount())
    host?.remove()
    render({
      commands: [],
      fileIndex: prepareQuickOpenFiles(['src/renderer/components/CommandPalette.tsx']),
      onOpenFile: () => {},
      onRevealFile: () => {}
    })
    type('CommandPalette')
    expect(document.body.querySelector<HTMLInputElement>('.palette__input')?.value).toBe('CommandPalette')
    const fileRow = [...document.querySelectorAll('.palette__item')].find((row) =>
      row.textContent?.includes('CommandPalette.tsx')
    )
    expect(fileRow?.textContent).toContain('CommandPalette.tsx')
    expect(document.querySelector('.palette__list')?.textContent).toContain('Local files')
    expect(fileRow?.querySelector('.palette__secondary')?.getAttribute('title')).toBe('Show containing folder')
    expect(fileRow?.textContent).not.toContain('src/renderer/components/CommandPalette.tsx')
  })

  it('maps the empty state without changing the no-file vocabulary behavior', () => {
    useSchoolMode.setState({ enabled: false, hydrated: true })
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { 'No matches': 'Nothing found' },
      entryCount: 1
    })
    render({ commands: [] })
    expect(document.querySelector('.palette__empty')?.textContent).toBe('Nothing found')
  })
})
