import { describe, it, expect } from 'vitest'
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTION_REGISTRY,
  allSectionIds,
  FIRST_SECTION_ID,
  visibleSettingsGroups
} from './nav'

describe('SETTINGS_GROUPS', () => {
  // The exact count is the point: this is a tripwire, so that ADDING a section is a deliberate
  // act that updates this number and the SettingsIcons record together. The icon record is keyed
  // by SettingsSectionId, and a section registered without an icon is a type error nobody sees
  // until the build — which is exactly how several sections shipped iconless.
  it('lists exactly 37 sections with no duplicates', () => {
    const ids = allSectionIds()
    expect(ids).toHaveLength(37)
    expect(new Set(ids).size).toBe(37)
  })
  it('starts at a section that exists in the groups', () => {
    expect(allSectionIds()).toContain(FIRST_SECTION_ID)
  })
  it('uses one runtime registration for every routed and navigable section', () => {
    expect(SETTINGS_SECTION_REGISTRY).toHaveLength(37)
    expect(new Set(SETTINGS_SECTION_REGISTRY.map((entry) => entry.id)).size).toBe(37)
    expect(SETTINGS_SECTION_REGISTRY.map((entry) => entry.id).sort()).toEqual(
      allSectionIds().sort()
    )
    expect(SETTINGS_SECTION_REGISTRY.every((entry) => typeof entry.render === 'function')).toBe(true)
    expect(
      visibleSettingsGroups(true).flatMap((group) => group.sections.map((section) => section.id)).sort()
    ).toEqual(SETTINGS_SECTION_REGISTRY.map((entry) => entry.id).sort())
  })
  it('hides mac-only sections off macOS, keeps them on', () => {
    const off = visibleSettingsGroups(false).flatMap((g) => g.sections.map((s) => s.id))
    expect(off).not.toContain('notch')
    // 37 total minus the one mac-only section.
    expect(off).toHaveLength(36)
    expect(visibleSettingsGroups(true)).toEqual(SETTINGS_GROUPS)
    // No group is left empty by the filter.
    expect(visibleSettingsGroups(false).every((g) => g.sections.length > 0)).toBe(true)
  })

  it('omits Language while School mode is unknown/on without hiding unrelated Interface controls', () => {
    const hidden = visibleSettingsGroups(true, false).flatMap((g) => g.sections.map((s) => s.id))
    expect(hidden).not.toContain('language')
    expect(hidden).toContain('appearance')
    expect(hidden).toContain('narrator')
    const restored = visibleSettingsGroups(true, true).flatMap((g) => g.sections.map((s) => s.id))
    expect(restored).toContain('language')
  })
})
