import type React from 'react'
import { useSettingsSearchState } from './context'
import { matchesEntry, type SettingsSearchEntry } from './search'

/** Renders its children only when the current query (plain text or regex — see context.ts)
 *  matches this row's metadata. */
export function SearchableRow({
  title,
  description,
  keywords,
  children
}: SettingsSearchEntry & { children: React.ReactNode }): React.JSX.Element | null {
  const state = useSettingsSearchState()
  if (!matchesEntry(state, { title, description, keywords })) {
    return null
  }
  return <>{children}</>
}
