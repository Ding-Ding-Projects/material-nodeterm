import { describe, it, expect } from 'vitest'
import { SETTINGS_GROUPS, allSectionIds, FIRST_SECTION_ID, visibleSettingsGroups } from './nav'

describe('SETTINGS_GROUPS', () => {
  // The exact count is the point: this is a tripwire, so that ADDING a section is a deliberate
  // act that updates this number and the SettingsIcons record together. The icon record is keyed
  // by SettingsSectionId, and a section registered without an icon is a type error nobody sees
  // until the build — which is exactly how several sections shipped iconless.
  it('lists exactly 34 sections with no duplicates', () => {
    const ids = allSectionIds()
    expect(ids).toHaveLength(34)
    expect(new Set(ids).size).toBe(34)
  })
  it('starts at a section that exists in the groups', () => {
    expect(allSectionIds()).toContain(FIRST_SECTION_ID)
  })
  it('hides mac-only sections off macOS, keeps them on', () => {
    const off = visibleSettingsGroups(false).flatMap((g) => g.sections.map((s) => s.id))
    expect(off).not.toContain('notch')
    // 34 total minus the one mac-only section.
    expect(off).toHaveLength(33)
    expect(visibleSettingsGroups(true)).toEqual(SETTINGS_GROUPS)
    // No group is left empty by the filter.
    expect(visibleSettingsGroups(false).every((g) => g.sections.length > 0)).toBe(true)
  })
})
