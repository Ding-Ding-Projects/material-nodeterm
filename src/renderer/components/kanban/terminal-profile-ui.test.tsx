// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { WindowsTerminalProfile } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { terminalProfileChoices } from '../../lib/terminal-profile-actions'
import { ContextMenu } from '../ContextMenu'
import { CardModalTerminalProfile } from './CardModal'
import {
  kanbanRestartProfileMenuItem,
  kanbanTerminalProfileCreateOptions,
  selectedKanbanTerminalProfile
} from './terminal-profile-ui'

vi.mock('./ModalTerminal', () => ({ ModalTerminal: () => null }))
vi.mock('../../nodes/BrowserSurface', () => ({ BrowserSurface: () => null }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const detectedProfiles: WindowsTerminalProfile[] = [
  {
    id: 'pwsh',
    label: 'PowerShell 7',
    kind: 'pwsh',
    available: true
  },
  {
    id: 'wsl:Removed Linux',
    label: 'WSL — Removed Linux',
    kind: 'wsl',
    available: false,
    unavailableReason: 'The distribution is no longer installed.'
  }
]

function button(label: string): HTMLButtonElement {
  const hit = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
    item.textContent?.includes(label)
  )
  if (!hit) throw new Error(`missing button ${label}`)
  return hit
}

describe('Kanban terminal profile UI', () => {
  it('maps production creation leaves to the exact stable profile id and disabled reason', () => {
    expect(kanbanTerminalProfileCreateOptions(terminalProfileChoices(detectedProfiles))).toEqual([
      {
        key: 'terminal-profile:pwsh',
        label: 'PowerShell 7',
        choice: { kind: 'terminal', profileId: 'pwsh' },
        disabled: false,
        hint: undefined
      },
      {
        key: 'terminal-profile:wsl:Removed Linux',
        label: 'WSL — Removed Linux',
        choice: { kind: 'terminal', profileId: 'wsl:Removed Linux' },
        disabled: true,
        hint: 'The distribution is no longer installed.'
      }
    ])
  })

  it('distinguishes an unavailable selected profile from an unverified detection failure', () => {
    const missing = selectedKanbanTerminalProfile('wsl:Missing Linux', detectedProfiles, {
      loading: false,
      initialized: true,
      error: null
    })
    expect(missing).toMatchObject({
      label: 'WSL — Missing Linux',
      availability: 'unavailable',
      disabled: true,
      hint: 'This selected profile is no longer detected on this machine.'
    })

    const failedRead = selectedKanbanTerminalProfile('cmd', [], {
      loading: false,
      initialized: true,
      error: 'Profile detection failed.'
    })
    expect(failedRead).toMatchObject({
      label: 'Command Prompt',
      availability: 'unknown',
      disabled: true,
      hint: 'Profile detection failed.'
    })
  })

  it('shows the selected profile label and its actionable availability in the modal header chip', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const profile = selectedKanbanTerminalProfile('wsl:Removed Linux', detectedProfiles, {
      loading: false,
      initialized: true,
      error: null
    })

    act(() => root.render(<CardModalTerminalProfile profile={profile} />))

    const chip = host.querySelector<HTMLElement>('.kanban-modal__profile')!
    expect(chip.textContent).toContain('WSL — Removed Linux')
    expect(chip.textContent).toContain('unavailable')
    expect(chip.getAttribute('aria-label')).toContain('The distribution is no longer installed.')
    expect(chip.getAttribute('title')).toBe('The distribution is no longer installed.')

    act(() => root.unmount())
    host.remove()
  })

  it('forwards the exact card-menu anchor for an available restart and keeps unavailable rows inert', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSelect = vi.fn()
    const choices = terminalProfileChoices(detectedProfiles)
    const item = kanbanRestartProfileMenuItem({
      nodeId: 'agent-node-1',
      anchor: { x: 321, y: 654 },
      profiles: choices,
      detection: { loading: false, initialized: true, error: null },
      canRecyclePersistentSession: true,
      assessProfile: () => ({ disabled: false }),
      onSelect
    })

    act(() => root.render(<ContextMenu x={10} y={10} items={[item]} onClose={() => {}} />))
    act(() => button('Restart with profile').click())

    const unavailable = button('WSL — Removed Linux')
    expect(unavailable.getAttribute('aria-disabled')).toBe('true')
    expect(unavailable.getAttribute('title')).toBe('The distribution is no longer installed.')
    expect(unavailable.textContent).toContain('The distribution is no longer installed.')
    act(() => unavailable.click())
    expect(onSelect).not.toHaveBeenCalled()

    act(() => button('PowerShell 7').click())
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('agent-node-1', choices[0], {
      x: 321,
      y: 654
    })

    act(() => root.unmount())
    host.remove()
  })

  it('disables every restart row when the host cannot prove the persistent session ended', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSelect = vi.fn()
    const item = kanbanRestartProfileMenuItem({
      nodeId: 'terminal-1',
      anchor: { x: 1, y: 2 },
      profiles: terminalProfileChoices(detectedProfiles.slice(0, 1)),
      detection: { loading: false, initialized: true, error: null },
      canRecyclePersistentSession: false,
      assessProfile: () => ({ disabled: false }),
      onSelect
    })

    act(() => root.render(<ContextMenu x={10} y={10} items={[item]} onClose={() => {}} />))
    act(() => button('Restart with profile').click())
    const powerShell = button('PowerShell 7')
    expect(powerShell.getAttribute('aria-disabled')).toBe('true')
    expect(powerShell.textContent).toContain(
      'This host cannot confirm that the old persistent session ended.'
    )
    act(() => powerShell.click())
    expect(onSelect).not.toHaveBeenCalled()

    act(() => root.unmount())
    host.remove()
  })

  it('makes a localized agent restriction inert while leaving eligible profiles selectable', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSelect = vi.fn()
    const choices = terminalProfileChoices(detectedProfiles)
    const item = kanbanRestartProfileMenuItem({
      nodeId: 'agent-node-2',
      anchor: { x: 8, y: 9 },
      profiles: choices,
      detection: { loading: false, initialized: true, error: null },
      canRecyclePersistentSession: true,
      assessProfile: (_nodeId, profileId) =>
        profileId.startsWith('wsl:')
          ? {
              disabled: true,
              reason: 'Choose a profile in the current agent environment.'
            }
          : { disabled: false },
      onSelect
    })

    act(() => root.render(<ContextMenu x={10} y={10} items={[item]} onClose={() => {}} />))
    act(() => button('Restart with profile').click())

    const wsl = button('WSL — Removed Linux')
    // Detection already proved this profile unavailable, so its more specific machine reason wins.
    expect(wsl.textContent).toContain('The distribution is no longer installed.')
    act(() => wsl.click())
    expect(onSelect).not.toHaveBeenCalled()

    act(() => button('PowerShell 7').click())
    expect(onSelect).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    host.remove()
  })

  it('surfaces a missing-custom-agent reason and cannot invoke the restart handler', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const onSelect = vi.fn()
    const item = kanbanRestartProfileMenuItem({
      nodeId: 'custom-agent-node',
      anchor: { x: 5, y: 6 },
      profiles: terminalProfileChoices(detectedProfiles.slice(0, 1)),
      detection: { loading: false, initialized: true, error: null },
      canRecyclePersistentSession: true,
      assessProfile: () => ({
        disabled: true,
        reason: 'Restore this custom agent launch command before restarting.'
      }),
      onSelect
    })

    act(() => root.render(<ContextMenu x={10} y={10} items={[item]} onClose={() => {}} />))
    act(() => button('Restart with profile').click())
    const powerShell = button('PowerShell 7')
    expect(powerShell.getAttribute('aria-disabled')).toBe('true')
    expect(powerShell.textContent).toContain(
      'Restore this custom agent launch command before restarting.'
    )
    act(() => powerShell.click())
    expect(onSelect).not.toHaveBeenCalled()

    act(() => root.unmount())
    host.remove()
  })
})
