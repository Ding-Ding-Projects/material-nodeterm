// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { mapTemplate } from './UpdateCard'
import { phonePairCodeLabel } from './PhonePairPopover'
import { renderStatusSummary, statusSearchCorpus } from './StatusSurface'
import { vocabularyProvenanceLine } from './WelcomeScreen'
import { ptyPressureCopy } from './PtyPressureBanner'
import { UpdateCard } from './UpdateCard'
import { StatusSurface } from './StatusSurface'
import { PhonePairPopover } from './PhonePairPopover'
import { PtyPressureBanner } from './PtyPressureBanner'
import { WelcomeScreen } from './WelcomeScreen'
import { AnnouncementBanner } from './AnnouncementBanner'
import { ResumeCard } from './ResumeCard'
import { SessionMemoryPanel } from './SessionMemoryPanel'
import { RemoteAccessDialog } from './RemoteAccessDialog'
import { SshProjectDialog } from './SshProjectDialog'
import { DictationOverlay } from './DictationOverlay'
import { SessionsSidebar } from './SessionsSidebar'
import { SessionContext } from '../session/session'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import { useSettings } from '../state/settings'
import { useProjects } from '../state/projects'
import { useSshServers } from '../state/sshServers'
import { useSessionMemory } from '../state/sessionMemory'
import { releaseGate } from '../../../shared/project-status'

const mapAuthored = (text: string): string =>
  text.replace('Update', 'Refresh').replace('Built', 'Assembled').replace('built', 'assembled').replace('terminal', 'shell box')

describe('shell and session vocabulary boundaries', () => {
  let root: Root | undefined
  let host: HTMLDivElement | undefined

  beforeEach(() => {
    useSettings.setState({ settings: DEFAULT_SETTINGS, base: DEFAULT_SETTINGS, hydrated: true })
    useSchoolMode.setState({ enabled: false, hydrated: true, name: 'School mode' })
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    host?.remove()
    root = undefined
    host = undefined
    usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0, loadedAt: null, lastError: null })
    useSchoolMode.setState({ enabled: false, hydrated: false })
    vi.restoreAllMocks()
  })

  function mount(element: React.JSX.Element): void {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root?.render(element))
  }

  it('maps update templates without changing version or percentage facts', () => {
    const collidingMapper = (text: string): string =>
      text.replace('Update', 'Refresh').replace('0.4.119', 'spoofed-version').replace('42', 'spoofed-percent')
    expect(
      mapTemplate('Update v{version} is downloading at {percent}%.', { version: '0.4.119', percent: '42' }, collidingMapper)
    ).toBe('Refresh v0.4.119 is downloading at 42%.')
  })

  it('maps only the TOTP accessibility prefix and preserves the live code', () => {
    expect(phonePairCodeLabel('123456', (text) => text.replace('TOTP', 'access').replace('123456', 'spoofed-code'))).toBe('Current access code 123456')
  })

  it('renders typed status summary parts and searches the visible mapped corpus', () => {
    const card = {
      id: 'capture',
      title: 'Built terminal captures',
      state: 'verified' as const,
      summary: 'Built terminal captures from commit abc12345.',
      summaryParts: [
        { kind: 'authored' as const, text: 'Built terminal captures from commit ' },
        { kind: 'factual' as const, text: 'abc12345' }
      ],
      recordedAt: null,
      evidence: [{ label: 'Capture commit', value: 'abc12345' }],
      rows: []
    }
    const mapper = (text: string): string => mapAuthored(text).replace('abc12345', 'spoofed-fact')
    expect(renderStatusSummary(card, mapper)).toBe('Assembled shell box captures from commit abc12345')
    const corpus = statusSearchCorpus(card, { label: 'Verified' }, mapper)
    expect(corpus).toContain('Assembled shell box captures')
    expect(corpus).toContain('abc12345')
  })

  it('keeps changelog and release-note row text raw in both rendering and search', () => {
    const card = releaseGate(
      [{
        version: '0.4.119',
        date: '2026-08-26',
        dateMs: Date.parse('2026-08-26T00:00:00.000Z'),
        commits: [],
        items: [{ category: 'Fixed', text: 'Release note terminal wording' }]
      }],
      '0.4.119'
    )
    const mapper = (text: string): string => text.replace('terminal', 'shell box').replace('Release note', 'Mapped note')
    const corpus = statusSearchCorpus(card, { label: 'Verified' }, mapper)
    expect(card.rows[0].labelOwnership).toBe('factual')
    expect(corpus).toContain('Release note terminal wording')
    expect(corpus).not.toContain('Mapped note shell box wording')
  })

  it('maps authored provenance words while retaining the stamped version and date facts', () => {
    const line = vocabularyProvenanceLine('0.4.119', undefined, (text) => text.replace('build time', 'stamp').replace('0.4.119', 'spoofed-version'))
    expect(line).toContain('v0.4.119')
    expect(line).toContain('stamp')
    expect(line).toContain('this build carries no build stamp')
  })

  it('keeps measured PTY counts factual while exposing typed authored body parts', () => {
    const copy = ptyPressureCopy({ level: 'critical', usage: 509, ceiling: 511 })
    expect(copy?.bodyParts.filter((part) => part.kind === 'factual').map((part) => part.text)).toEqual(['509', '511'])
    expect(copy?.bodyParts.map((part) => part.text).join('')).toContain('(509 of 511 pty devices)')
    expect(copy?.body).toContain('(509 of 511 pty devices)')
  })

  it('does not allow vocabulary terms that look like measurements to rewrite the PTY facts', () => {
    const copy = ptyPressureCopy({ level: 'elevated', usage: 42, ceiling: 100 })
    const mapper = (text: string): string => text.replace('42', 'four hundred')
    const rendered = copy?.bodyParts.map((part) => (part.kind === 'authored' ? mapper(part.text) : part.text)).join('')
    expect(rendered).toContain('(42 of 100 pty devices)')
    expect(rendered).not.toContain('four hundred')
  })

  it('maps UpdateCard copy and immediately restores shipped wording when School mode changes', async () => {
    let onAvailable: ((info: unknown) => void) | undefined
    const noopSubscription = () => () => {}
    ;(window as any).nodeTerminal = {
      updates: {
        onAvailable: (callback: (info: unknown) => void) => { onAvailable = callback; return noopSubscription() },
        onProgress: noopSubscription,
        onDownloaded: noopSubscription,
        onNotAvailable: noopSubscription,
        onError: noopSubscription,
        getPolicy: async () => ({ mandatory: false }),
        restart: vi.fn(),
        check: vi.fn()
      }
    }
    usePersonalVocabulary.setState({ entries: { 'Downloading Update': 'Fresh update' }, status: 'loaded', entryCount: 1 })
    mount(<UpdateCard />)
    act(() => onAvailable?.({ manual: false, version: '0.4.119', indeterminateProgress: true }))
    expect(host?.querySelector('.update-card__title')?.textContent).toBe('Fresh update')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(host?.querySelector('.update-card__title')?.textContent).toBe('Downloading Update')
  })

  it('maps StatusSurface search and card copy using the same live corpus', () => {
    usePersonalVocabulary.setState({ entries: { Typecheck: 'Typecheck translated' }, status: 'loaded', entryCount: 1 })
    mount(<StatusSurface />)
    expect(host?.textContent).toContain('Typecheck translated')
    const input = host?.querySelector<HTMLInputElement>('.md3-status-search__input')
    if (!input) throw new Error('missing status search')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    act(() => {
      setter?.call(input, 'translated')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host?.querySelectorAll('.status-card')).toHaveLength(1)
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(host?.textContent).toContain('Typecheck')
    expect(host?.textContent).not.toContain('Typecheck translated')
  })

  it('maps the phone pairing shell but never changes its live code', async () => {
    ;(window as any).nodeTerminal = {
      serverDeployment: {
        start: async () => ({ ok: true, url: 'https://example.test', totpCode: '123456' }),
        onProgress: () => () => {},
        currentTotp: async () => '123456'
      }
    }
    usePersonalVocabulary.setState({ entries: { 'Open nodeterm on another device': 'Open elsewhere', 'Current TOTP code': 'Code now' }, status: 'loaded', entryCount: 2 })
    await act(async () => mount(<PhonePairPopover anchor={{ right: 100, bottom: 100 }} onClose={() => {}} onOpenSettings={() => {}} />))
    expect(document.body.querySelector('.phone-pair__title')?.textContent).toContain('Open elsewhere')
    expect(document.body.querySelector('[aria-label="Code now 123456"]')).not.toBeNull()
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(document.body.querySelector('.phone-pair__title')?.textContent).toContain('Open nodeterm on another device')
    expect(document.body.textContent).toContain('123456')
  })

  it('maps PTY authored copy while keeping the measured numbers unchanged', () => {
    let listener: ((reading: { level: 'critical'; usage: number; ceiling: number }) => void) | undefined
    ;(window as any).nodeTerminal = {
      onPtyPressure: (callback: typeof listener) => { listener = callback; return () => {} }
    }
    usePersonalVocabulary.setState({ entries: { 'Out of terminal capacity': 'No headroom' }, status: 'loaded', entryCount: 1 })
    mount(<PtyPressureBanner isMac={false} onError={() => {}} />)
    act(() => listener?.({ level: 'critical', usage: 42, ceiling: 100 }))
    expect(host?.querySelector('.announce-banner__title')?.textContent).toBe('No headroom')
    expect(host?.textContent).toContain('(42 of 100 pty devices)')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(host?.querySelector('.announce-banner__title')?.textContent).toBe('Out of terminal capacity')
  })

  it('maps Welcome copy and live School mode changes without remapping project data', () => {
    usePersonalVocabulary.setState({ entries: { terminals: 'shell boxes', 'New project': 'Fresh mission' }, status: 'loaded', entryCount: 2 })
    mount(
      <WelcomeScreen
        onNewProject={() => {}}
        onOpenFolder={() => {}}
        onCloneRepo={() => {}}
        onOpenProjectFile={() => {}}
        onConnectSsh={() => {}}
      />
    )
    expect(host?.textContent).toContain('Fresh mission')
    expect(host?.textContent).toContain('shell boxes')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(host?.textContent).toContain('New project')
    expect(host?.textContent).toContain('terminals')
    expect(host?.textContent).not.toContain('Fresh mission')
  })

  it('keeps remote announcement text raw while mapping its own dismiss action', async () => {
    ;(window as any).nodeTerminal = {
      announcements: { fetch: async () => [{ id: 'a1', title: 'Security notice from provider', body: 'Provider exact message', level: 'warning' }] }
    }
    usePersonalVocabulary.setState({ entries: { Dismiss: 'Hide notice', provider: 'mapped provider' }, status: 'loaded', entryCount: 2 })
    await act(async () => mount(<AnnouncementBanner />))
    expect(document.body.textContent).toContain('Security notice from provider')
    expect(document.body.textContent).toContain('Provider exact message')
    expect(document.body.querySelector('.announce-banner__close')?.getAttribute('title')).toBe('Hide notice')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(document.body.textContent).toContain('Security notice from provider')
    expect(document.body.textContent).not.toContain('Hide notice')
  })

  it('maps ResumeCard chrome while preserving user breadcrumb text', () => {
    const project = {
      id: 'p1', name: 'user project', color: '#6750a4', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [],
      breadcrumbs: [{ nodeId: 'n1', at: 1000, note: 'user note terminal' }]
    } as any
    usePersonalVocabulary.setState({ entries: { 'Resume where you left off': 'Continue here', Dismiss: 'Hide card' }, status: 'loaded', entryCount: 2 })
    mount(<ResumeCard project={project} nodes={[{ id: 'n1' }]} onOpen={() => {}} />)
    expect(host?.textContent).toContain('Continue here')
    expect(host?.textContent).toContain('user note terminal')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(host?.textContent).toContain('Resume where you left off')
  })

  it('maps SessionMemoryPanel empty-state copy and follows a live School change', () => {
    useSessionMemory.setState({ ok: false, rows: [], mem: null, loading: false, loadedScope: null })
    usePersonalVocabulary.setState({ entries: { 'Could not measure sessions on this machine.': 'Memory reading unavailable' }, status: 'loaded', entryCount: 1 })
    mount(<SessionMemoryPanel onGoToNode={() => {}} onKillSession={() => {}} onClose={() => {}} />)
    expect(host?.textContent).toContain('Memory reading unavailable')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(host?.textContent).toContain('Could not measure sessions on this machine.')
  })

  it('maps RemoteAccessDialog chrome while preserving provider status details', async () => {
    ;(window as any).nodeTerminal = {
      relayHost: { dockerContexts: async () => [], start: async () => ({ offer: '' }), stop: async () => {} }
    }
    usePersonalVocabulary.setState({ entries: { 'Remote access': 'Remote doorway', 'Checking Docker…': 'Checking runtime…' }, status: 'loaded', entryCount: 2 })
    await act(async () => mount(<RemoteAccessDialog onClose={() => {}} />))
    expect(document.body.textContent).toContain('Remote doorway')
    expect(document.body.textContent).toContain('No Docker context was found')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(document.body.textContent).toContain('Remote access')
    expect(document.body.textContent).not.toContain('Remote doorway')
  })

  it('maps SshProjectDialog empty-state copy and restores it under School mode', () => {
    useSshServers.setState({ servers: [] })
    usePersonalVocabulary.setState({ entries: { 'No saved servers yet.': 'No saved boxes yet' }, status: 'loaded', entryCount: 1 })
    mount(<SshProjectDialog onCreate={() => {}} onManage={() => {}} onClose={() => {}} />)
    expect(document.body.textContent).toContain('No saved boxes yet')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(document.body.textContent).toContain('No saved servers yet.')
  })

  it('maps DictationOverlay warning copy through the session provider boundary', () => {
    usePersonalVocabulary.setState({ entries: { 'Select a terminal node first.': 'Choose a shell box first' }, status: 'loaded', entryCount: 1 })
    mount(
      <SessionContext.Provider value={{ id: 'test', source: 'local', label: 'test', api: {} as any, status: 'connected' }}>
        <DictationOverlay target={null} stopSignal={0} onClose={() => {}} onOpenLicense={() => {}} />
      </SessionContext.Provider>
    )
    expect(document.body.textContent).toContain('Choose a shell box first')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(document.body.textContent).toContain('Select a terminal node first.')
  })

  it('maps SessionsSidebar empty state and follows a live School change', () => {
    useProjects.setState({ projects: [], activeProjectId: '', reloadNonce: 0 })
    usePersonalVocabulary.setState({ entries: { 'No sessions yet.': 'No shell boxes yet' }, status: 'loaded', entryCount: 1 })
    mount(
      <SessionContext.Provider value={{ id: 'test', source: 'local', label: 'test', api: { git: { status: async () => null } } as any, status: 'connected' }}>
        <SessionsSidebar
          open
          pinned={false}
          liveActiveNodes={null}
          onTogglePin={() => {}}
          onClose={() => {}}
          onFocusNode={() => {}}
          onCloseSession={() => {}}
          onRenameSession={() => {}}
          onAiNameSession={() => {}}
          onRowContextMenu={() => {}}
          onProjectContextMenu={() => {}}
          onSwitchProject={() => {}}
          onAddToProject={() => {}}
          onMoveToGroup={() => {}}
          onAiNameGroup={() => {}}
          onReorder={() => {}}
          onReorderGroup={() => {}}
          onReorderProject={() => {}}
        />
      </SessionContext.Provider>
    )
    expect(host?.textContent).toContain('No shell boxes yet')
    act(() => useSchoolMode.setState({ enabled: true, hydrated: true, name: 'School mode' }))
    expect(host?.textContent).toContain('No sessions yet.')
  })
})
