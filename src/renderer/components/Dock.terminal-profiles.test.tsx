// @vitest-environment jsdom
import { act } from 'react'
import type { ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dock } from './Dock'
import type { TerminalProfileChoice } from '../lib/terminal-profile-actions'
import { useSettings } from '../state/settings'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'

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
})

function button(label: string, startsWith = false): HTMLButtonElement {
  const hit = [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((item) => {
    const text = item.textContent?.trim() ?? ''
    return startsWith ? text.startsWith(label) : text === label
  })
  if (!hit) throw new Error(`missing button ${label}`)
  return hit
}

function renderDock(
  overrides: Partial<ComponentProps<typeof Dock>> = {}
): {
  onAddTerminal: ReturnType<typeof vi.fn>
  onAddTerminalWithProfile: ReturnType<typeof vi.fn>
} {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const onAddTerminal = vi.fn()
  const onAddTerminalWithProfile = vi.fn()
  act(() =>
    root?.render(
      <Dock
        dirty={false}
        zoomPct={100}
        canUndo={false}
        canRedo={false}
        onAddTerminal={onAddTerminal}
        offersTerminalProfiles
        terminalProfileChoices={choices}
        onAddTerminalWithProfile={onAddTerminalWithProfile}
        onAddSticky={() => {}}
        onAddDino={() => {}}
        onAddAgent={() => {}}
        onOpenFile={() => {}}
        onAddRemote={() => {}}
        onConnectRemote={() => {}}
        onUndo={() => {}}
        onRedo={() => {}}
        onSave={() => {}}
        onFitView={() => {}}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onDictate={() => {}}
        dictateActive={false}
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

describe('Dock Windows terminal profile creation', () => {
  it('keeps the ordinary Terminal row as the direct saved-default action', () => {
    const { onAddTerminal, onAddTerminalWithProfile } = renderDock()

    openAddMenu()
    act(() => button('Terminal').click())

    expect(onAddTerminal).toHaveBeenCalledOnce()
    expect(onAddTerminalWithProfile).not.toHaveBeenCalled()
    expect(host?.querySelector('.dock-menu')).toBeNull()
  })

  it('passes only the selected stable id from the profile drill-in', () => {
    const { onAddTerminal, onAddTerminalWithProfile } = renderDock()

    openProfileMenu()
    expect(host?.querySelector('[role="menu"]')?.getAttribute('aria-label')).toBe(
      'Choose terminal profile'
    )
    act(() => button('PowerShell 7').click())

    expect(onAddTerminalWithProfile).toHaveBeenCalledOnce()
    expect(onAddTerminalWithProfile).toHaveBeenCalledWith('pwsh')
    expect(onAddTerminal).not.toHaveBeenCalled()
    expect(host?.querySelector('.dock-menu')).toBeNull()
  })

  it('keeps unavailable choices inert and associates the visible failure reason', () => {
    const { onAddTerminalWithProfile } = renderDock()

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
    expect(host?.querySelector('.dock-menu')).toBeTruthy()
  })

  it('hides profile creation outside the local Windows capability', () => {
    renderDock({ offersTerminalProfiles: false })

    openAddMenu()

    expect(
      [...(host?.querySelectorAll('button') ?? [])].some((item) =>
        item.textContent?.includes('New terminal with profile')
      )
    ).toBe(false)
    expect(button('Terminal')).toBeTruthy()
  })

  it('preserves a profile detection failure as distinct empty-state copy', () => {
    renderDock({
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
    renderDock()

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
    renderDock()

    openAddMenu()
    act(() => button('New console with preset…').click())

    // Detected labels are machine facts and remain outside the prose vocabulary boundary.
    expect(button('PowerShell 7')).toBeTruthy()
    expect(host?.textContent).not.toContain('WRONG 7')
  })
})
