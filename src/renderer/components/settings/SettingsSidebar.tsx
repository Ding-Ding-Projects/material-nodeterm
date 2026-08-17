import { useRef } from 'react'
import { cn } from '@renderer/ui/cn'
import { Input } from '@renderer/ui/Input'
import { visibleSettingsGroups, type SettingsSectionId } from './nav'
import { useI18n } from '@renderer/lib/i18n'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import type { RegexSearchFieldState } from '../../lib/regex/useRegexSearchField'
import { useSchoolMode } from '../../state/schoolMode'

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
import { matchesEntry } from './search'
import { SectionIcon } from './SettingsIcons'

export function SettingsSidebar({
  activeSectionId,
  search,
  onSelect,
  onClose
}: {
  activeSectionId: SettingsSectionId
  search: RegexSearchFieldState
  onSelect: (id: SettingsSectionId) => void
  onClose: () => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  // `search.active` — not `value !== ''` — because in regex mode an INVALID pattern must not dim
  // every row as though nothing matched; the field owns that distinction.
  const hasQuery = search.active
  // Sidebar rows are compact (256px column, up to ~22 of them) — bilingual mode joins primary +
  // secondary on ONE line here (`ts`) rather than stacking a second row per item, which would
  // crowd badly. Contrast with LanguageSection's own body copy, which has room to stack.
  const { ts } = useI18n()
  // Once School mode is renamed, the shipped "School mode" label must never surface anywhere —
  // this is the one spot the sidebar nav's otherwise-static section titles need a live override.
  const schoolModeName = useSchoolMode((s) => s.name)
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const groups = visibleSettingsGroups(isMac, schoolModeHydrated && !schoolModeEnabled)
  return (
    <aside className="flex w-[256px] shrink-0 flex-col border-r border-border bg-panel">
      <div
        className="flex items-center px-3 pb-2 pt-14"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={ts('settings.nav.backToApp', 'Back to app')}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="flex items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-sm font-medium text-muted outline-none transition-colors hover:bg-fill-weak hover:text-text"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.5 3.5 5 7l3.5 3.5" />
          </svg>
          {ts('settings.nav.backToApp', 'Back to app')}
        </button>
      </div>

      <div className="px-3 pb-3">
        <div className="relative flex items-center gap-1">
          <div className="relative flex-1">
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-2"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="6" cy="6" r="4" />
              <path d="M9.2 9.2 12 12" />
            </svg>
            <Input
              ref={inputRef}
              className="h-8 w-full pl-8"
              value={search.value}
              onChange={(e) => search.setValue(e.target.value)}
              placeholder={
                search.mode === 'regex'
                  ? ts('settings.nav.searchRegex', 'Search settings (regex)')
                  : ts('settings.nav.search', 'Search settings')
              }
              aria-label={ts('settings.nav.search', 'Search settings')}
            />
          </div>
          <AnchoredRegexBuilder
            search={search}
            fieldRef={inputRef}
            label={ts('settings.nav.regexBuilder', 'Regex — settings search')}
          />
        </div>
        {search.error && <p className="mt-1 px-1 text-[11px] leading-snug text-danger">{search.error}</p>}
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.id} className="space-y-0.5">
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-2">
              {ts(`settings.group.${group.id}`, group.title)}
            </p>
            {group.sections.map((s) => {
              const label = s.id === 'school-mode' ? schoolModeName : s.title
              const isActive = activeSectionId === s.id
              // Two different titles on purpose.
              //   DISPLAY: School mode shows its user-chosen `label` verbatim and is never routed
              //     through `ts()` — the whole point of the rename is that the shipped name stops
              //     existing for this user, and a localized shipped string would reintroduce it.
              //     Every other section shows its localized title.
              //   SEARCH: matched on the SHIPPED title, because the nav catalogue and the section
              //     registry are keyed by it — searching the translated string would make a row
              //     unfindable by the very name the rest of the app uses for it. School mode is
              //     the exception again: it is matched on `label` ONLY, so typing the shipped
              //     "School mode" cannot light up a row the user has renamed away from it.
              const isSchoolMode = s.id === 'school-mode'
              const sectionTitle = isSchoolMode ? label : ts(`settings.section.${s.id}`, s.title)
              const searchTitle = isSchoolMode ? label : s.title
              const dimmed = hasQuery && !matchesEntry(search, { title: searchTitle })
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'group flex w-full items-center gap-2.5 rounded-lg border-0 px-3 py-2 text-left text-[13px] outline-none transition-colors',
                    isActive
                      ? 'bg-white/[0.09] font-medium text-text ring-1 ring-inset ring-white/10'
                      : 'bg-panel text-muted hover:bg-white/[0.05] hover:text-text',
                    dimmed && 'opacity-35'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center transition-colors',
                      isActive ? 'text-text' : 'text-muted-2 group-hover:text-muted'
                    )}
                  >
                    <SectionIcon id={s.id} />
                  </span>
                  <span className="truncate">{sectionTitle}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
