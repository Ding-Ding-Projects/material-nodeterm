// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setHostVocabularySchoolState } from '../lib/personalVocabulary/hostMessage'
import { useSchoolMode } from '../state/schoolMode'

const CACHE_KEY = 'nodeterm.personalVocabulary.v1'

type HudPush = {
  rows: Array<{
    nodeId: string
    title: string
    model?: string
    state: 'working' | 'needsYou' | 'done' | 'idle'
    prompt?: string
    activity?: string
    contextPercent?: number
    subagents: Array<{ id: string; label?: string; state: 'working' | 'done' }>
    unread: boolean
    updatedAt: number
  }>
  schoolModeEnabled: boolean
  schoolModeHydrated: boolean
  bar: number
  width: number
  notchWidth: number
  notchCenterX: number
  hasNotch: boolean
  hoverExpand: boolean
}

let pushRows: ((push: HudPush) => void) | undefined

function saveVocabulary(entries: Record<string, string>): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    version: 1,
    entries,
    entryCount: Object.keys(entries).length,
    savedAt: Date.now()
  }))
}

function push(overrides: Partial<HudPush> = {}): void {
  pushRows?.({
    rows: [],
    schoolModeEnabled: false,
    schoolModeHydrated: true,
    bar: 24,
    width: 560,
    notchWidth: 168,
    notchCenterX: 280,
    hasNotch: false,
    hoverExpand: true,
    ...overrides
  })
}

describe('HUD vocabulary and accessible controls', () => {
  beforeAll(async () => {
    document.body.innerHTML = '<div id="hud"></div>'
    const hud = {
      onRows(callback: (value: HudPush) => void): () => void {
        pushRows = callback
        return () => { pushRows = undefined }
      },
      setIgnoreMouse: vi.fn(),
      focusNode: vi.fn(),
      setExpanded: vi.fn(),
      dismiss: vi.fn()
    }
    Object.defineProperty(window, 'hud', { configurable: true, value: hud })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'))
    await import('./main')
  })

  beforeEach(() => {
    localStorage.clear()
    useSchoolMode.setState({ enabled: false, hydrated: false })
    setHostVocabularySchoolState({ enabled: false, hydrated: false })
  })

  it('maps HUD-owned labels while preserving dynamic facts and keyboard access', () => {
    saveVocabulary({
      ' more': ' extra',
      ' needs you': ' call now',
      ' unread': ' new',
      ' running': ' busy',
      ' idle': ' quiet',
      Unread: 'New',
      'Working…': 'Busy…',
      'Needs you': 'Call now',
      Finished: 'Complete',
      Idle: 'Quiet',
      'You: ': 'Ask: ',
      'Show fewer': 'Show less',
      'Remove from HUD': 'Hide from pill',
      Go: 'Open',
      subagent: 'pig',
      subagents: 'pigs',
      m: 'min',
      '% left': '% left'
    })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    setHostVocabularySchoolState({ enabled: false, hydrated: true })
    const now = Date.now()
    push({ rows: [
      {
        nodeId: 'node-1',
        title: 'node-model-title',
        model: 'model-7',
        state: 'needsYou',
        prompt: 'prompt model/path',
        contextPercent: 42,
        subagents: [{ id: 'sub-1', label: 'subagent model', state: 'working' }],
        unread: false,
        updatedAt: now - 5 * 60_000
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        nodeId: `node-${i + 2}`,
        title: `title-${i}`,
        state: 'idle' as const,
        activity: `activity model ${i}`,
        subagents: [],
        unread: i === 0,
        updatedAt: now
      }))
    ] })

    const hud = document.querySelector('.hud-capsule')
    expect(hud?.textContent).toContain('node-model-title')
    expect(hud?.textContent).toContain('model-7')
    expect(hud?.textContent).toContain('prompt model/path')
    expect(hud?.textContent).toContain('5min')
    expect(hud?.textContent).toContain('58% left')
    expect(hud?.textContent).toContain('Ask: prompt model/path')
    expect((document.querySelector('.hud-row') as HTMLElement).getAttribute('aria-label')).toContain('Call now')
    expect(hud?.textContent).toContain('extra')
    expect(hud?.textContent).toContain('New')
    expect(hud?.textContent).not.toContain('machine-7')

    const row = document.querySelector('.hud-row') as HTMLElement
    const more = document.querySelector('.hud-panel__more') as HTMLElement
    const subs = document.querySelector('.hud-subs__toggle') as HTMLElement
    expect(row.getAttribute('role')).toBe('button')
    expect(row.tabIndex).toBe(0)
    expect(more.getAttribute('role')).toBe('button')
    expect(subs.getAttribute('role')).toBe('button')
    expect(subs.getAttribute('aria-expanded')).toBe('false')

    subs.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(document.querySelector('.hud-subs__list')).toBeTruthy()
  })

  it('restores shipped HUD wording on the next push when School mode turns on', () => {
    saveVocabulary({ Unread: 'New', 'Needs you': 'Call now', ' more': ' extra' })
    useSchoolMode.setState({ enabled: false, hydrated: true })
    setHostVocabularySchoolState({ enabled: false, hydrated: true })
    push({ rows: [{
      nodeId: 'node-1',
      title: 'title',
      state: 'needsYou',
      subagents: [],
      unread: true,
      updatedAt: Date.now()
    }, ...Array.from({ length: 6 }, (_, i) => ({
      nodeId: `node-${i + 2}`,
      title: `title-${i}`,
      state: 'idle' as const,
      subagents: [],
      unread: false,
      updatedAt: Date.now()
    }))] })
    expect(document.querySelector('.hud-capsule')?.textContent).toContain('Call now')
    expect(document.querySelector('.hud-capsule')?.textContent).toContain('New')

    useSchoolMode.setState({ enabled: true, hydrated: true })
    setHostVocabularySchoolState({ enabled: true, hydrated: true })
    push({ rows: [{
      nodeId: 'node-1',
      title: 'title',
      state: 'needsYou',
      subagents: [],
      unread: true,
      updatedAt: Date.now()
    }, ...Array.from({ length: 6 }, (_, i) => ({
      nodeId: `node-${i + 2}`,
      title: `title-${i}`,
      state: 'idle' as const,
      subagents: [],
      unread: false,
      updatedAt: Date.now()
    }))] })
    const text = document.querySelector('.hud-capsule')?.textContent ?? ''
    expect(text).toContain('Needs you')
    expect(text).toContain('Unread')
    expect(text).toContain('more')
    expect(text).not.toContain('Call now')
  })
})
