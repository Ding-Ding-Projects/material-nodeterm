// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FabMenu } from './FabMenu'
import type { TerminalProfileChoice } from '../lib/terminal-profile-actions'
import { useSettings } from '../state/settings'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import { useProjects } from '../state/projects'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const choices: TerminalProfileChoice[] = [
  { id: 'pwsh', label: 'PowerShell 7', disabled: false },
  {
    id: 'wsl:Missing Linux',
    label: 'WSL — Missing Linux',
    disabled: true,
    hint: 'The distribution is no longer installed.'
  }
]

let root: Root | undefined
let host: HTMLDivElement | undefined
const originalSettings = useSettings.getState().settings
const originalBase = useSettings.getState().base

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = undefined
  host = undefined
  useSettings.setState({ settings: originalSettings, base: originalBase })
  usePersonalVocabulary.setState({ entries: {}, status: 'no-file', entryCount: 0 })
  useSchoolMode.setState({ enabled: false })
  useProjects.getState().hydrate({ version: 2, activeProjectId: '', projects: [] })
})

function button(label: string, startsWith = false): HTMLButtonElement {
  const hit = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((item) => {
    const text = item.textContent?.trim() ?? ''
    return startsWith ? text.startsWith(label) : text === label
  })
  if (!hit) throw new Error(`missing button ${label}`)
  return hit
}

function renderFabMenu(
  overrides: Partial<ComponentProps<typeof FabMenu>> = {}
): {
  onAddTerminal: ReturnType<typeof vi.fn>
  onAddTerminalWithProfile: ReturnType<typeof vi.fn>
} {
  const project = useProjects.getState().addProject('Fixture project')
  useProjects.setState({ projects: [project], activeProjectId: project.id })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const onAddTerminal = vi.fn()
  const onAddTerminalWithProfile = vi.fn()
  act(() =>
    root?.render(
      <FabMenu
        onOpenCatalog={() => {}}
        onAddTerminal={onAddTerminal}
        offersTerminalProfiles
        terminalProfileChoices={choices}
        onAddTerminalWithProfile={onAddTerminalWithProfile}
        onAddSticky={() => {}}
        onAddLoop={() => {}}
        onAddAuthenticator={() => {}}
        onAddDino={() => {}}
        onAddAgent={() => {}}
        onOpenFile={() => {}}
        onAddRemote={() => {}}
        onConnectRemote={() => {}}
        {...overrides}
      />
    )
  )
  return { onAddTerminal, onAddTerminalWithProfile }
}

function openAddMenu(): void {
  const add = host?.querySelector<HTMLButtonElement>('button[title="Add node"]')
  if (!add) throw new Error('missing Add node button')
  act(() => add.click())
}

function openProfileMenu(): void {
  openAddMenu()
  act(() => button('New terminal with profile…').click())
}

describe('FabMenu (nav rail) Windows terminal profile creation', () => {
  it('closes and disables node creation when no project is active', () => {
    renderFabMenu()
    openAddMenu()
    act(() => useProjects.setState({ activeProjectId: '' }))
    const add = host?.querySelector<HTMLButtonElement>('.md3-fab')
    expect(add?.disabled).toBe(true)
    expect(add?.title).toBe('Open or create a project before adding nodes.')
    expect(add?.getAttribute('aria-label')).toContain('Open or create a project first.')
    expect(host?.querySelector('.md3-fab-menu')).toBeNull()
  })

  it('keeps the ordinary Terminal row as the direct saved-default action', () => {
    const { onAddTerminal, onAddTerminalWithProfile } = renderFabMenu()

    openAddMenu()
    act(() => button('Terminal').click())

    expect(onAddTerminal).toHaveBeenCalledOnce()
    expect(onAddTerminalWithProfile).not.toHaveBeenCalled()
    expect(host?.querySelector('.md3-fab-menu')).toBeNull()
  })

  it('passes only the selected stable id from the profile drill-in', () => {
    const { onAddTerminal, onAddTerminalWithProfile } = renderFabMenu()

    openProfileMenu()
    expect(host?.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe(
      'Choose terminal profile'
    )
    act(() => button('PowerShell 7').click())

    expect(onAddTerminalWithProfile).toHaveBeenCalledOnce()
    expect(onAddTerminalWithProfile).toHaveBeenCalledWith('pwsh')
    expect(onAddTerminal).not.toHaveBeenCalled()
    expect(host?.querySelector('.md3-fab-menu')).toBeNull()
  })

  it('keeps unavailable choices inert and associates the visible failure reason', () => {
    const { onAddTerminalWithProfile } = renderFabMenu()

    openProfileMenu()
    const unavailable = button('WSL — Missing Linux', true)
    const reasonId = unavailable.getAttribute('aria-describedby')
    expect(unavailable.getAttribute('aria-disabled')).toBe('true')
    expect(reasonId).toBeTruthy()
    expect(host?.querySelector(`#${reasonId}`)?.textContent).toBe(
      'The distribution is no longer installed.'
    )
    expect(unavailable.textContent).toContain('The distribution is no longer installed.')

    act(() => unavailable.click())
    expect(onAddTerminalWithProfile).not.toHaveBeenCalled()
    expect(host?.querySelector('.md3-fab-menu')).toBeTruthy()
  })

  it('hides profile creation outside the local Windows capability', () => {
    renderFabMenu({ offersTerminalProfiles: false })

    openAddMenu()

    expect(
      [...(host?.querySelectorAll('button') ?? [])].some((item) =>
        item.textContent?.includes('New terminal with profile')
      )
    ).toBe(false)
    expect(button('Terminal')).toBeTruthy()
  })

  it('preserves a profile detection failure as distinct empty-state copy', () => {
    renderFabMenu({
      terminalProfileChoices: [],
      terminalProfileEmptyState: {
        label: 'Profile detection failed',
        hint: 'Access to the Windows profile catalog was denied.'
      }
    })

    openProfileMenu()
    const failed = button('Profile detection failed', true)
    const reasonId = failed.getAttribute('aria-describedby')
    expect(failed.getAttribute('aria-disabled')).toBe('true')
    expect(host?.querySelector(`#${reasonId}`)?.textContent).toBe(
      'Access to the Windows profile catalog was denied.'
    )
    expect(failed.textContent).not.toContain('No Windows terminal profiles were detected')
  })

  it('renders profile controls in Cantonese through the shipped language catalog', () => {
    useSettings.setState({
      settings: { ...originalSettings, languageMode: 'yue' },
      base: { ...originalBase, languageMode: 'yue' }
    })
    // Language mode only applies once a real "School mode is off" record has loaded
    // (schoolModeAllowsOptionalFeatures fails closed on the pre-hydration default); without this
    // the resolver silently falls back to English and the Cantonese button is never rendered.
    useSchoolMode.setState({ enabled: false, hydrated: true })
    renderFabMenu()

    openAddMenu()
    act(() => button('用設定檔新增終端機…').click())

    expect(host?.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe(
      '揀終端機設定檔'
    )
    expect(button('返去新節點')).toBeTruthy()
  })

  it('applies personal vocabulary to localized profile prose without rewriting profile facts', () => {
    usePersonalVocabulary.setState({
      entries: { terminal: 'console', profile: 'preset', PowerShell: 'WRONG' },
      status: 'loaded',
      entryCount: 3
    })
    renderFabMenu()

    openAddMenu()
    act(() => button('New console with preset…').click())

    // Detected labels are machine facts and remain outside the prose vocabulary boundary.
    expect(button('PowerShell 7')).toBeTruthy()
    expect(host?.textContent).not.toContain('WRONG 7')
  })
})
