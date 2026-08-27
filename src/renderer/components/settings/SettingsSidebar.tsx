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
import { settingsSidebarSearchEntry } from './vocabulary'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'
import { useMemo } from 'react'
import { cn } from '@renderer/ui/cn'
import { Input } from '@renderer/ui/Input'
import { visibleSettingsGroups, type SettingsGroup, type SettingsSectionId } from './nav'
import { matchesQuery } from './search'
import { SectionIcon } from './SettingsIcons'
import { ProjectGlyph } from '../ProjectGlyph'

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)

export function SettingsSidebar({
  activeSectionId,
  search,
  onSelect,
  onClose
  onQueryChange,
  onClose,
  extraGroups
}: {
  activeSectionId: SettingsSectionId
  search: RegexSearchFieldState
  onSelect: (id: SettingsSectionId) => void
  onClose: () => void
  /** Groups appended after the static nav — e.g. the render-time "Projects" group, which the
   *  caller builds from live project state (kept out of the sidebar so it needs no store
   *  subscription of its own). */
  extraGroups?: SettingsGroup[]
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  // `search.active` — not `value !== ''` — because in regex mode an INVALID pattern must not dim
  // every row as though nothing matched; the field owns that distinction.
  const hasQuery = search.active
  // Sidebar rows are compact (300px column, up to ~22 of them) — bilingual mode joins primary +
  // secondary on ONE line here (`ts`) rather than stacking a second row per item, which would
  // crowd badly. Contrast with LanguageSection's own body copy, which has room to stack.
  const { ts } = useI18n()
  const vocab = useVocabularyMapper()
  // Once School mode is renamed, the shipped "School mode" label must never surface anywhere —
  // this is the one spot the sidebar nav's otherwise-static section titles need a live override.
  const schoolModeName = useSchoolMode((s) => s.name)
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const groups = visibleSettingsGroups(isMac, schoolModeHydrated && !schoolModeEnabled)
  const hasQuery = query.trim() !== ''
  const GROUPS = useMemo(
    () => [...visibleSettingsGroups(isMac), ...(extraGroups ?? [])],
    [extraGroups]
  )
  return (
    <aside className="md3-settings-sidebar flex shrink-0 flex-col">
      <div
        className="flex items-center px-4 pb-2 pt-14"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={ts('settings.nav.backToApp', 'Back to app')}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="md3-settings-sidebar__back"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.5 3.5 5 7l3.5 3.5" />
          </svg>
          {ts('settings.nav.backToApp', 'Back to app')}
        </button>
      </div>

      <div className="px-4 pb-4">
        <div className="md3-settings-search">
          <svg
            aria-hidden="true"
            className="md3-settings-search__icon"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <circle cx="7" cy="7" r="4.6" />
            <path d="M10.5 10.5 14 14" />
          </svg>
          <Input
            ref={inputRef}
            value={search.value}
            onChange={(e) => search.setValue(e.target.value)}
            placeholder={
              search.mode === 'regex'
                ? ts('settings.nav.searchRegex', 'Search settings (regex)')
                : ts('settings.nav.search', 'Search settings')
            }
            vocabularyMode="factual"
            aria-label={ts('settings.nav.search', 'Search settings')}
          />
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
            <p className="md3-settings-sidebar__group-title">
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
              const dimmed = hasQuery && !matchesEntry(search, settingsSidebarSearchEntry(s, schoolModeName, vocab, sectionTitle, true))
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn('md3-settings-nav-row', dimmed && 'md3-settings-nav-row--dimmed')}
                >
                  <span className="md3-settings-nav-row__icon">
                    <SectionIcon id={s.id} />
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center transition-colors',
                      isActive ? 'text-text' : 'text-muted-2 group-hover:text-muted'
                    )}
                  >
                    {s.color ? (
                      // A project section — the row's own color/icon (see nav.ts'
                      // `projectsSettingsGroup`), instead of the generic folder glyph every
                      // project section used to share.
                      <ProjectGlyph
                        icon={s.icon}
                        color={s.color}
                        name={s.title}
                        variant="monogram"
                        size={16}
                        className="flex size-4 items-center justify-center rounded-[3px] text-[9px] font-semibold uppercase text-white"
                      />
                    ) : (
                      <SectionIcon id={s.id} />
                    )}
                  </span>
                  <span className="md3-settings-nav-row__label">{sectionTitle}</span>
                </button>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
