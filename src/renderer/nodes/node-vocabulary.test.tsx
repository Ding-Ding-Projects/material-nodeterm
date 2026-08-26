// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import { BrowserStartPage } from './BrowserStartPage'
import { SHORTCUTS } from './browserIcons'
import { DiscardedPlate } from './DiscardedPlate'
import {
  mapAroundExactFacts,
  pendingLaunchErrorOwnership,
  pendingLaunchSummaryText
} from './nodeVocabulary'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useSchoolMode.setState({ enabled: false, hydrated: true })
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('node renderer personal vocabulary boundaries', () => {
  const nodeFacts: Array<[string, string, string[]]> = [
    ['TerminalNode', 'Link out to Claude', ['Claude']],
    ['StickyNode', 'Write a note', []],
    ['GroupNode', 'Merge to main', []],
    ['EditorNode', 'Ctrl+M to edit', ['Ctrl+M']],
    ['DiffNode', 'staged changes', ['staged']],
    ['BrowserNode', 'Google', ['Google']],
    ['BrowserSurface', 'Enter a URL', ['URL']],
    ['BrowserStartPage', 'Search Google', ['Google']],
    ['BrowserExtensionsPanel', 'Extensions', []],
    ['VideoNode', 'Loading video', []],
    ['WebNode', 'Open in browser', []],
    ['LoopNode', 'Claude scheduler', ['Claude', 'scheduler']],
    ['NativeLoopNode', 'Loop interval', []],
    ['NsisInstallerNode', 'Generated NSIS script', ['NSIS']],
    ['ServiceNode', 'Address for Docker', ['Docker']],
    ['AuthenticatorNode', 'Copy this code', []],
    ['AnnotationNode', 'Arrowhead on', []],
    ['DinoNode', 'HI 00042', ['HI']],
    ['SubagentNode', 'Open output', []],
    ['ChatPanel', 'Message Claude', ['Claude']]
  ]

  it.each(nodeFacts)('keeps %s provider, shortcut, status, or brand facts intact', (_node, value, facts) => {
    const mapped = mapAroundExactFacts(value, facts, (text) => text.replace('Search', 'Find').replace('Message', 'Send'))
    for (const fact of facts) expect(mapped).toContain(fact)
  })

  it('maps authored text around exact provider and brand facts', () => {
    const mapped = mapAroundExactFacts(
      'Message Claude in Google Chrome',
      ['Claude', 'Google Chrome'],
      (value) => value.replace('Message', 'Send')
    )
    expect(mapped).toBe('Send Claude in Google Chrome')
  })

  it('maps pending-launch prose while preserving the raw action and agent id', () => {
    const map = (value: string) => value.replace('resume', 'continue').replace('start', 'begin')
    expect(pendingLaunchSummaryText({ kind: 'agent', action: 'resume', agentId: 'codex' }, map)).toBe(
      'continue codex'
    )
    expect(pendingLaunchSummaryText({ kind: 'agent', action: 'start', agentId: 'gemini' }, map)).toBe(
      'begin gemini'
    )
    expect(pendingLaunchSummaryText({ kind: 'shell-command', command: 'echo exact' }, map)).toBe(
      'the queued terminal command'
    )
  })

  it('classifies pending-launch errors from result ownership, not matching strings', () => {
    expect(pendingLaunchErrorOwnership({ ok: false, reason: 'session-unavailable' }, false)).toBe('authored')
    expect(pendingLaunchErrorOwnership({ ok: false, reason: 'session-unavailable' }, true)).toBe('authored')
    expect(pendingLaunchErrorOwnership({ ok: false, reason: 'delivery-failed' }, true)).toBe('external-factual')
  })

  it.each([
    ['loop provider', 'Claude scheduler', ['Claude']],
    ['chat provider', 'Message Claude', ['Claude']],
    ['browser shortcut', 'Google', ['Google']],
    ['browser shortcut', 'YouTube', ['YouTube']],
    ['browser shortcut', 'GitHub', ['GitHub']],
    ['browser shortcut', 'Gmail', ['Gmail']],
    ['browser shortcut', 'X', ['X']],
    ['browser shortcut', 'ChatGPT', ['ChatGPT']],
    ['browser shortcut', 'Reddit', ['Reddit']],
    ['browser shortcut', 'Wikipedia', ['Wikipedia']],
    ['service brand', 'Connect Docker host', ['Docker']],
    ['service brand', 'Open Proxmox', ['Proxmox']],
    ['service brand', 'Open GitLab', ['GitLab']],
    ['service brand', 'Open Home Assistant', ['Home Assistant']],
    ['service brand', 'Open FreePBX', ['FreePBX']],
    ['service brand', 'Open Minecraft', ['Minecraft']],
    ['terminal runtime', 'Running plain codex', ['codex']]
  ] as Array<[string, string, string[]]>)('keeps the %s fact exact while mapping nearby copy', (_label, value, facts) => {
    const mapped = mapAroundExactFacts(value, facts, (text) => text.replace('Running', 'Launching').replace('Connect', 'Reach'))
    expect(mapped).toContain(facts[0])
    if (value.startsWith('Running')) expect(mapped).toBe('Launching plain codex')
    if (value.startsWith('Connect')) expect(mapped).toBe('Reach Docker host')
  })

  it('maps BrowserStartPage prose while preserving the navigated URL', () => {
    usePersonalVocabulary.setState({
      entries: {
        'or type a URL': 'or enter a link'
      },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    let navigated = ''
    act(() => root.render(<BrowserStartPage onNavigate={(url) => { navigated = url }} />))
    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe('Search Google or enter a link')
    expect(host.querySelector('.startpage__tile-label')?.textContent).toBe('Google')
    act(() => host.querySelector<HTMLButtonElement>('.startpage__tile')?.click())
    expect(navigated).toBe(SHORTCUTS[0].url)
  })

  it('maps the released and reopening status plate', () => {
    usePersonalVocabulary.setState({
      entries: { 'Reopening…': 'Opening again…' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    act(() => root.render(<DiscardedPlate restoring />))
    expect(host.textContent).toContain('Opening again…')
  })

  it('updates an already-mounted node when the local vocabulary changes', () => {
    act(() => root.render(<DiscardedPlate restoring />))
    expect(host.textContent).toContain('Reopening…')
    act(() =>
      usePersonalVocabulary.setState({
        entries: { 'Reopening…': 'Opening again…' },
        status: 'loaded',
        entryCount: 1,
        loadedAt: Date.now(),
        lastError: null
      })
    )
    expect(host.textContent).toContain('Opening again…')
  })

  it('suppresses the mapper while School mode is enabled', () => {
    usePersonalVocabulary.setState({
      entries: { 'Reopening…': 'Opening again…' },
      status: 'loaded',
      entryCount: 1,
      loadedAt: Date.now(),
      lastError: null
    })
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true }))
    act(() => root.render(<DiscardedPlate restoring />))
    expect(host.textContent).toContain('Reopening…')
    expect(host.textContent).not.toContain('Opening again…')
  })
})
