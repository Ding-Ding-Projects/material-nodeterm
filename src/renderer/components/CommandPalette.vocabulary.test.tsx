// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { CommandPalette, type Command } from './CommandPalette'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'

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
}): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root?.render(
      <CommandPalette
        commands={props.commands}
        extraCommands={props.extraCommands}
        onClose={() => {}}
      />
    )
  )
}

function type(q: string): void {
  const input = document.body.querySelector<HTMLInputElement>('.palette__input')
  act(() => {
    if (!input) throw new Error('no palette input')
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set
    setter?.call(input, q)
    input.dispatchEvent(new Event('input', { bubbles: true }))
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

  it('shows the shipped wording while School mode is on, and while it is still unknown', () => {
    loadVocabulary()
    useSchoolMode.setState({ enabled: true, hydrated: true })
    render({ commands: [{ id: 'a', label: 'New terminal', run: () => {} }] })
    expect(rowText()).toContain('New terminal')
    act(() => root?.unmount())
    host?.remove()

    // Pre-hydration `enabled: false` is a placeholder, not a confirmed-off record.
    usePersonalVocabulary.setState({
      status: 'loaded',
      entries: { terminal: 'shell box' },
      entryCount: 1
    })
    useSchoolMode.setState({ enabled: false, hydrated: false })
    render({ commands: [{ id: 'a', label: 'New terminal', run: () => {} }] })
    expect(rowText()).toContain('New terminal')
  })

  it('shows the shipped wording when no file has been uploaded', () => {
    useSchoolMode.setState({ enabled: false, hydrated: true })
    render({ commands: [{ id: 'a', label: 'New terminal', run: () => {} }] })
    expect(rowText()).toContain('New terminal')
  })
})
