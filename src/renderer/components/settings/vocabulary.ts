import type { SettingsSectionRef } from './nav'
import type { SettingsSearchEntry } from './search'

export type SettingsVocabularyMap = (value: string | undefined) => string | undefined

/** Search both the shipped settings vocabulary and the currently visible replacement. */
export function settingsSearchEntryWithVocabulary(
  entry: SettingsSearchEntry,
  map: SettingsVocabularyMap
): SettingsSearchEntry {
  return {
    ...entry,
    title: map(entry.title) ?? entry.title,
    description: map(entry.description),
    keywords: entry.keywords?.flatMap((keyword) => [keyword, map(keyword) ?? keyword])
  }
}

/** School mode is user-renamable. Once renamed, its shipped title must not remain searchable. */
export function settingsSidebarSearchEntry(
  section: SettingsSectionRef,
  schoolModeName: string,
  map: SettingsVocabularyMap,
  localizedTitle?: string,
  alreadyMapped = false
): SettingsSearchEntry {
  const isSchool = section.id === 'school-mode'
  const title = isSchool
    ? schoolModeName
    : localizedTitle ?? (alreadyMapped ? section.title : map(section.title) ?? section.title)
  const shippedAlias = isSchool ? undefined : section.title
  return {
    title,
    keywords: shippedAlias
      ? [shippedAlias, title, ...(alreadyMapped ? [] : [map(title) ?? title])]
      : [title]
  }
}
