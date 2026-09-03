// @vitest-environment jsdom

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { usePersonalVocabulary } from '@renderer/state/personalVocabulary'
import { useSchoolMode } from '@renderer/state/schoolMode'
import { useKidsActivity } from '@renderer/state/kidsActivity'
import { useKidsMode } from '@renderer/state/kidsMode'
import { useEnableKidsDialog } from './entry'
import { KidsHome } from './KidsHome'
import { KidsGate } from './KidsGate'
import { KidsParent } from './KidsParent'
import { KidsStickers } from './KidsStickers'
import { EnableKidsModeDialogHost } from './EnableKidsModeDialog'
import { KidsActivityCanvas } from './KidsActivityCanvas'
import { KidsShell } from './KidsShell'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const narration = vi.hoisted(() => ({ speak: vi.fn() }))
const destructive = vi.hoisted(() => ({ open: vi.fn() }))

vi.mock('./narration', () => ({ narrateKidsScreen: narration.speak }))
vi.mock('@renderer/state/destructiveGate', () => ({ openDestructiveGate: destructive.open }))
vi.mock('@renderer/state/permissionMode', () => ({
  setKidsAllowedPermissionMode: vi.fn(),
  useActivePermissionMode: () => 'plan',
  ensureActiveAgentLaunchPlan: vi.fn(async () => ({ mode: 'manual' }))
}))
vi.mock('@renderer/components/NodeBoundary', () => ({ withNodeBoundary: (component: unknown) => component }))
vi.mock('@renderer/nodes/TerminalNode', () => ({ TerminalNode: () => React.createElement('div', null, 'terminal-session') }))
vi.mock('@renderer/nodes/StickyNode', () => ({ StickyNode: () => React.createElement('div', null, 'drawing-note') }))
vi.mock('@renderer/state/workspace', () => ({
  createAgentNode: () => ({ id: 'agent', type: 'agent', position: { x: 0, y: 0 }, data: {} }),
  createStickyNode: () => ({ id: 'sticky', type: 'sticky', position: { x: 0, y: 0 }, data: {} }),
  createTerminalNode: () => ({ id: 'terminal', type: 'terminal', position: { x: 0, y: 0 }, data: {} })
}))
vi.mock('@xyflow/react', () => ({
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  ReactFlow: ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'kids-flow' }, children),
  ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useNodesState: (initial: unknown[]) => [initial, vi.fn(), vi.fn()],
  useReactFlow: () => ({ setCenter: vi.fn() })
}))

afterEach(() => {
  cleanup()
  narration.speak.mockClear()
  destructive.open.mockClear()
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
  useKidsActivity.setState({
    entries: [], stickers: 0, allowRealTerminal: true, dailyLimitMinutes: null,
    lockOnLaunch: false, minutesByDate: {}
  } as never)
  useKidsMode.setState({
    enabled: true, name: 'Kids mode', hydrated: true, policyStatus: 'ready', generation: 0,
    credentialState: 'absent'
  } as never)
  useEnableKidsDialog.getState().hide()
})

function loadVocabulary(entries: Record<string, string>): void {
  usePersonalVocabulary.setState({
    entries,
    status: 'loaded',
    entryCount: Object.keys(entries).length,
    loadedAt: Date.now(),
    lastError: null
  })
  useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
}

describe('Kids vocabulary boundaries', () => {
  it.each([
    ['home', 'Kids home', 'Child home', () => render(<KidsHome modeName="Kids mode" onOpenGate={vi.fn()} onOpenActivity={vi.fn()} onOpenStickers={vi.fn()} />)],
    ['stickers', 'My stickers', 'Sticker shelf', () => render(<KidsStickers onBack={vi.fn()} />)],
    ['parent', 'Grown-up screen', 'Adult dashboard', () => render(<KidsParent modeName="Kids mode" verifiedPin="1234" onBackToKids={vi.fn()} />)]
  ])('maps authored visible and accessible copy on the %s screen', (_screen, source, replacement, mount) => {
    loadVocabulary({ [source]: replacement })
    mount()
    if (source === 'Kids home' || source === 'My stickers') {
      expect(document.querySelector(`[data-screen-label="${replacement}"]`)).toBeTruthy()
    } else {
      expect(screen.getByText(replacement)).toBeTruthy()
    }
    expect(screen.queryByText(source, { exact: true })).toBeNull()
  })

  it('keeps configured names, counts, timestamps, and activity records factual', () => {
    useKidsActivity.setState({
      stickers: 7,
      entries: [{ id: 'activity-42', kind: 'beep', what: 'Talked to Beep', detail: 'session-private', when: Date.now() }]
    } as never)
    loadVocabulary({
      'Kids mode': 'Child label',
      'Talked to Beep': 'Do not rewrite activity',
      'session-private': 'Do not rewrite content',
      '7': 'Do not rewrite count'
    })
    render(<KidsParent modeName="Kids mode" verifiedPin="1234" onBackToKids={vi.fn()} />)

    expect(screen.getAllByText(/Kids mode/).length).toBeGreaterThan(0)
    expect(screen.getByText('Talked to Beep')).toBeTruthy()
    expect(screen.getByText('session-private')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.queryByText('Child label')).toBeNull()
    expect(screen.queryByText('Do not rewrite activity')).toBeNull()
  })

  it('maps gate actions and accessible names while preserving the mode name in the times-up fact', () => {
    loadVocabulary({
      'All done for today': 'Today is complete',
      'Continue to grown-up controls': 'Open adult controls',
      'Grown-up PIN': 'Adult access code',
      'Reset the Kids mode PIN': 'Reset adult access code',
      'I never set this PIN': 'I did not set this code'
    })
    useKidsMode.setState({ credentialState: 'present', refreshCredentialState: vi.fn() } as never)
    render(<KidsGate modeName="Kids mode" variant="timesUp" onVerified={vi.fn()} onBackToKids={vi.fn()} />)

    expect(screen.getByText('Today is complete')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'I did not set this code' })).toBeTruthy()
    expect(screen.getByText("Kids mode's time for today is up. A grown-up can enter the PIN to keep going.")).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Adult access code' })).toBeTruthy()
  })

  it('maps the enable dialog title, hint, pad accessible name, disclosure, and cancel action', () => {
    loadVocabulary({
      'Choose a grown-up PIN': 'Pick an adult access code',
      'Choose a 4-digit PIN': 'Pick a four-number code',
      Cancel: 'Close this panel',
      'Kids mode': 'Child label'
    })
    useKidsMode.setState({ credentialState: 'absent', refreshCredentialState: vi.fn() } as never)
    useEnableKidsDialog.getState().show()
    render(<EnableKidsModeDialogHost />)

    expect(screen.getByText('Pick an adult access code')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Pick a four-number code' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close this panel' })).toBeTruthy()
    expect(screen.getByText(/Child label keeps things friendly/)).toBeTruthy()
  })

  it('maps activity chrome and narrator text without changing node identity or sticker facts', () => {
    loadVocabulary({
      'Talk to Beep': 'Chat with Beep',
      'Switch activity': 'Change activity',
      'Back to Beep': 'Return to Beep'
    })
    render(<KidsActivityCanvas active="beep" onBack={vi.fn()} />)

    expect(screen.getByText('Chat with Beep')).toBeTruthy()
    expect(screen.getByRole('tablist', { name: 'Change activity' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Return to Beep' })).toBeTruthy()
    expect(narration.speak).toHaveBeenCalledWith('Chat with Beep.')
  })

  it('maps the shell loading status and keeps School mode suppression original', () => {
    loadVocabulary({ 'Checking the shared PIN state…': 'Checking the adult access state…' })
    useKidsMode.setState({ credentialState: 'loading', refreshCredentialState: vi.fn() } as never)
    render(<KidsShell />)
    expect(screen.getByRole('status').textContent).toBe('Checking the adult access state…')

    cleanup()
    useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' })
    render(<KidsHome modeName="Kids mode" onOpenGate={vi.fn()} onOpenActivity={vi.fn()} onOpenStickers={vi.fn()} />)
    expect(document.querySelector('[data-screen-label="Kids home"]')).toBeTruthy()
    expect(screen.queryByText('Child home')).toBeNull()
  })
})
