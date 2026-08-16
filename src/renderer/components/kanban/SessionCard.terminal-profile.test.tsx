// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { KanbanTerminalProfilePresentation } from './terminal-profile-ui'
import { SessionCard } from './SessionCard'

vi.mock('../../lib/personalVocabulary/useLocalizedVocabularyText', () => ({
  useLocalizedVocabularyText: () =>
    (id: string, fallback: string, params?: Record<string, string>): string => {
      const translated: Record<string, string> = {
        'terminalProfiles.header.statusAvailable': 'disponible',
        'terminalProfiles.header.statusUnavailable': 'indisponible',
        'terminalProfiles.header.statusUnknown': 'disponibilidad desconocida',
        'terminalProfiles.header.ariaLabel': 'Perfil de terminal: {profile}; {status}',
        'terminalProfiles.header.ariaLabelWithHint':
          'Perfil de terminal: {profile}; {status}: {hint}',
        'terminalProfiles.header.title': 'Perfil de terminal: {profile}'
      }
      let value = translated[id] ?? fallback
      for (const [key, fact] of Object.entries(params ?? {})) {
        value = value.replaceAll(`{${key}}`, fact)
      }
      return value
    }
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const callbacks = {
  onOpen: vi.fn(),
  onDragStart: vi.fn(),
  onDragEnd: vi.fn(),
  onDropAt: vi.fn(),
  onContext: vi.fn()
}

function profile(
  override: Partial<KanbanTerminalProfilePresentation> = {}
): KanbanTerminalProfilePresentation {
  return {
    id: 'wsl:Team 日本語',
    label: 'WSL — Team 日本語',
    disabled: false,
    availability: 'available',
    ...override
  }
}

describe('SessionCard terminal profile metadata', () => {
  it('shows a localized accessible profile chip on an agent card without rewriting its dynamic label', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    act(() =>
      root.render(
        <SessionCard
          session={{
            id: 'agent-profile-card',
            title: 'Agent task',
            color: '#123456',
            kind: 'terminal',
            agentId: 'claude',
            spawn: {}
          }}
          terminalProfile={profile()}
          {...callbacks}
        />
      )
    )

    const chip = host.querySelector<HTMLElement>('.kanban-card__profile')!
    expect(chip.textContent).toBe('WSL — Team 日本語')
    expect(chip.getAttribute('aria-label')).toBe(
      'Perfil de terminal: WSL — Team 日本語; disponible'
    )
    expect(chip.getAttribute('title')).toBe('Perfil de terminal: WSL — Team 日本語')

    act(() => root.unmount())
    host.remove()
  })

  it('keeps a machine-provided unavailable reason verbatim and exposes a non-color status mark', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const reason = 'Distribution «Team 日本語» was removed.'

    act(() =>
      root.render(
        <SessionCard
          session={{
            id: 'terminal-profile-card',
            title: 'Terminal',
            color: '#654321',
            kind: 'terminal',
            spawn: {}
          }}
          terminalProfile={profile({
            disabled: true,
            availability: 'unavailable',
            hint: reason
          })}
          {...callbacks}
        />
      )
    )

    const chip = host.querySelector<HTMLElement>('.kanban-card__profile')!
    expect(chip.textContent).toBe('WSL — Team 日本語!')
    expect(chip.getAttribute('title')).toBe(reason)
    expect(chip.getAttribute('aria-label')).toBe(
      `Perfil de terminal: WSL — Team 日本語; indisponible: ${reason}`
    )

    act(() => root.unmount())
    host.remove()
  })
})
