// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SETTINGS_SECTION_REGISTRY } from './nav'
import { SettingsSidebar } from './SettingsSidebar'
import { renderSettingsSectionHosts } from './SettingsPage'

afterEach(() => cleanup())

const search = {
  mode: 'text' as const,
  query: '',
  pattern: '',
  flags: 'i',
  value: '',
  active: false,
  error: null,
  setValue: vi.fn(),
  setFlags: vi.fn(),
  setMode: vi.fn(),
  toggleMode: vi.fn(),
  test: () => true,
  reset: vi.fn()
}

describe('SettingsPage and SettingsSidebar registry parity', () => {
  it('mounts the sidebar and materializes one host for every registry entry', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    render(
      <SettingsSidebar
        activeSectionId="agents"
        search={search}
        onSelect={onNavigate}
        onClose={onClose}
      />
    )

    const hosts = renderSettingsSectionHosts('agents', onClose, onNavigate, SETTINGS_SECTION_REGISTRY, true)
    expect(hosts).toHaveLength(SETTINGS_SECTION_REGISTRY.length)
    expect(hosts.map((host) => host.props['data-settings-section-host'])).toEqual(
      SETTINGS_SECTION_REGISTRY.map((entry) => entry.id)
    )
    expect(document.querySelector('[aria-label="Back to app"]')).toBeTruthy()
  })

  it('fails closed when a registered section has no host renderer', () => {
    const onClose = vi.fn()
    const onNavigate = vi.fn()
    const missingHostRegistry = [
      ...SETTINGS_SECTION_REGISTRY,
      { id: 'missing-host', title: 'Missing host' }
    ] as typeof SETTINGS_SECTION_REGISTRY

    expect(() =>
      renderSettingsSectionHosts('agents', onClose, onNavigate, missingHostRegistry, true)
    ).toThrow('Settings section "missing-host" has no registered host renderer.')
  })
})
