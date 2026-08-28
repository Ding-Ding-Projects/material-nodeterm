import { describe, it, expect } from 'vitest'
import { SETTINGS_GROUPS, allSectionIds, FIRST_SECTION_ID, visibleSettingsGroups, projectsSettingsGroup } from './nav'

describe('SETTINGS_GROUPS', () => {
  // The exact count is the point: this is a tripwire, so that ADDING a section is a deliberate
  // act that updates this number and the SettingsIcons record together. The icon record is keyed
  // by SettingsSectionId, and a section registered without an icon is a type error nobody sees
  // until the build — which is exactly how several sections shipped iconless.
  it('lists exactly 36 sections with no duplicates', () => {
    const ids = allSectionIds()
    expect(ids).toHaveLength(37)
    expect(new Set(ids).size).toBe(37)
  })
  it('lists exactly 25 sections with no duplicates', () => {
    const ids = allSectionIds()
    expect(ids).toHaveLength(25)
    expect(new Set(ids).size).toBe(25)
  })
  it('starts at a section that exists in the groups', () => {
    expect(allSectionIds()).toContain(FIRST_SECTION_ID)
  })
  it('hides mac-only sections off macOS, keeps them on', () => {
    const off = visibleSettingsGroups(false).flatMap((g) => g.sections.map((s) => s.id))
    expect(off).not.toContain('notch')
    // 37 total minus the one mac-only section.
    expect(off).toHaveLength(36)
    expect(off).toHaveLength(24)
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

describe('projectsSettingsGroup', () => {
  // NOTE (project-icons Task 2): this assertion used to read
  // `expect(g?.sections).toEqual([{ id: 'project-p1', title: 'Alpha' }])` — the exact bug this
  // task fixes (`color` was accepted on `ProjectNavItem` but silently dropped by `.map`). Updated
  // in place rather than left to rot, since a passing test that pins the dropped-color bug would
  // block the fix it's meant to catch.
  it('derives one row per project and returns null when empty', () => {
    const g = projectsSettingsGroup([{ id: 'p1', name: 'Alpha', color: '#fff' }])
    expect(g?.sections).toEqual([{ id: 'project-p1', title: 'Alpha', color: '#fff', icon: undefined }])
    expect(projectsSettingsGroup([])).toBeNull()
  })

  it('threads a project icon through onto its section row, alongside color', () => {
    const icon = { type: 'emoji', emoji: '🚀' } as const
    const g = projectsSettingsGroup([{ id: 'p1', name: 'Alpha', color: '#fff', icon }])
    expect(g?.sections).toEqual([{ id: 'project-p1', title: 'Alpha', color: '#fff', icon }])
  })

  it('leaves icon undefined for a project that has none', () => {
    const g = projectsSettingsGroup([{ id: 'p2', name: 'Beta', color: '#000' }])
    expect(g?.sections[0]?.icon).toBeUndefined()
    expect(g?.sections[0]?.color).toBe('#000')
  })
})
