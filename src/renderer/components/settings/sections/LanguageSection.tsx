import { useSettings } from '../../../state/settings'
import { useI18n } from '@renderer/lib/i18n'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Switch } from '@renderer/ui/Switch'
import { SegmentedPill } from '@renderer/ui/SegmentedPill'
import { SectionReset } from '../SectionReset'
import { LANGUAGE_RESET_KEYS } from '@renderer/lib/settingsReset'
import type { FunnyLevel, LanguageMode } from '@shared/i18n'
import { FUNNY_LEVEL_MAX, FUNNY_LEVEL_MIN, normalizeLanguageMode } from '@shared/i18n'
import { useSchoolMode } from '../../../state/schoolMode'
import { schoolModeAllowsOptionalFeatures } from '../../../lib/schoolModePolicy'
import { Slider } from '@renderer/ui/md3'
import { useVocabularyMapper } from '../../../lib/personalVocabulary/useVocabularyText'
import { settingsSearchEntryWithVocabulary } from '../vocabulary'

const ROWS = {
  mode: {
    title: 'Language mode',
    keywords: ['language', 'cantonese', 'yue', 'english', 'bilingual', 'locale', 'i18n']
  },
  funnyEn: {
    title: 'English funny level',
    keywords: ['funny', 'level', 'english', 'playful', 'tone', 'humour', 'humor', 'jokes']
  },
  funnyYue: {
    title: 'Cantonese funny level',
    keywords: ['funny', 'level', 'cantonese', 'yue', 'playful', 'tone', 'humour', 'humor', 'jokes']
  },
  emoji: {
    title: 'Show emojis in dialogs and message boxes',
    keywords: ['emoji', 'emoticon', 'decoration', 'dialog', 'message box', 'icon']
  }
}
const ENTRIES = Object.values(ROWS)

/** A funny-level 1..10 slider. Shared shape for the English and Cantonese sliders — the only
 *  difference between them is which settings key they write. */
function FunnyLevelSlider({
  value,
  onChange,
  ariaLabel
}: {
  value: FunnyLevel
  onChange: (v: FunnyLevel) => void
  ariaLabel: string
}): React.JSX.Element {
  const { t } = useI18n()
  const vocab = useVocabularyMapper()
  const mappedRows = {
    mode: settingsSearchEntryWithVocabulary(ROWS.mode, vocab),
    funnyEn: settingsSearchEntryWithVocabulary(ROWS.funnyEn, vocab),
    funnyYue: settingsSearchEntryWithVocabulary(ROWS.funnyYue, vocab),
    emoji: settingsSearchEntryWithVocabulary(ROWS.emoji, vocab)
  }
  const lowLabel = t('settings.language.level.1', '1 — Fully professional').primary
  const highLabel = t('settings.language.level.10', '10 — Maximum playfulness').primary
  return (
    <div className="flex items-center gap-3">
      <span className="w-[132px] shrink-0 text-right text-[11px] leading-tight text-muted-2">
        {lowLabel}
      </span>
      <Slider
        min={FUNNY_LEVEL_MIN}
        max={FUNNY_LEVEL_MAX}
        step={1}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value) as FunnyLevel)}
        className="w-40 accent-[var(--accent)]"
      />
      <span className="w-[132px] shrink-0 text-[11px] leading-tight text-muted-2">
        {highLabel}
      </span>
      <span className="w-4 shrink-0 text-right text-[12px] text-muted tabular-nums">{value}</span>
    </div>
  )
}

/**
 * Settings → Interface → Language.
 *
 * Language mode picks WHAT language nodeterm speaks in you; the two funny-level sliders pick HOW
 * it speaks — independently per language, because a user may want plain English with playful
 * Cantonese, or the reverse. The disclosure below is not decoration: it is the one place that
 * states, plainly, that the slider changes tone and never facts (src/shared/i18n/catalog.ts
 * carries the same rule as a comment for anyone adding a string).
 */
export function LanguageSection({ isActive }: { isActive: boolean }): React.JSX.Element | null {
  const vocab = useVocabularyMapper()
  const mappedRows = {
    mode: settingsSearchEntryWithVocabulary(ROWS.mode, vocab),
    funnyEn: settingsSearchEntryWithVocabulary(ROWS.funnyEn, vocab),
    funnyYue: settingsSearchEntryWithVocabulary(ROWS.funnyYue, vocab),
    emoji: settingsSearchEntryWithVocabulary(ROWS.emoji, vocab)
  }
  const languageMode = useSettings((s) => s.settings.languageMode)
  const funnyLevelEn = useSettings((s) => s.settings.funnyLevelEn)
  const funnyLevelYue = useSettings((s) => s.settings.funnyLevelYue)
  const baseFunnyLevelEn = useSettings((s) => s.base.funnyLevelEn)
  const baseFunnyLevelYue = useSettings((s) => s.base.funnyLevelYue)
  const showEmojiInDialogs = useSettings((s) => s.settings.showEmojiInDialogs)
  const update = useSettings((s) => s.update)
  const schoolModeEnabled = useSchoolMode((s) => s.enabled)
  const schoolModeHydrated = useSchoolMode((s) => s.hydrated)
  const { t } = useI18n()
  const languageFeaturesAllowed = schoolModeAllowsOptionalFeatures({
    enabled: schoolModeEnabled,
    hydrated: schoolModeHydrated
  })
  const updateIfAllowed = (patch: Parameters<typeof update>[0]): void => {
    // Re-check at the point of use: a shared-mode update can arrive between the browser queuing
    // an input event and React removing this section. A stale control must not write through the
    // School-mode suppression boundary during that narrow window.
    if (schoolModeAllowsOptionalFeatures(useSchoolMode.getState())) update(patch)
  }

  const title = t('settings.section.language', 'Language')
  const description = t(
    'settings.language.description',
    'Choose the language nodeterm speaks to you in, and how playful each language sounds.'
  )

  // School mode's contract is omission, not a disabled panel. Unknown hydration is omitted too:
  // a failed read is not proof that the shared mode is off.
  if (!languageFeaturesAllowed) return null

  return (
    <SettingsSection
      id="language"
      resolvedVocabulary={{ source: 'i18n', fields: 'all', searchEntries: 'mapped' }}
      title={title.primary}
      description={description.secondary ? `${description.primary} ${description.secondary}` : description.primary}
      isActive={isActive}
      searchEntries={Object.values(mappedRows)}
    >
      <SearchableRow {...mappedRows.mode} resolvedVocabulary={{ source: 'i18n', fields: 'all' }}>
        <FieldRow
          label={t('settings.language.mode.label', 'Language mode').primary}
          control={
            <SegmentedPill<LanguageMode>
              value={normalizeLanguageMode(languageMode)}
              vocabularyMode="factual"
              ariaLabel="Language mode"
              onChange={(v) => updateIfAllowed({ languageMode: v })}
              options={[
                { value: 'en', label: t('settings.language.mode.option.en', 'English').primary },
                { value: 'yue', label: t('settings.language.mode.option.yue', 'Cantonese').primary },
                {
                  value: 'bilingual',
                  label: t('settings.language.mode.option.bilingual', 'Bilingual').primary
                }
              ]}
            />
          }
        />
      </SearchableRow>

      <SearchableRow {...mappedRows.funnyEn} resolvedVocabulary={{ source: 'i18n', fields: 'all' }}>
        <FieldRow
          label={t('settings.language.funnyEn.label', 'English funny level').primary}
          control={
            <FunnyLevelSlider
              value={funnyLevelEn}
              ariaLabel="English funny level, 1 to 10"
              onChange={(v) => updateIfAllowed({ funnyLevelEn: v })}
            />
          }
        />
      </SearchableRow>

      <SearchableRow {...mappedRows.funnyYue} resolvedVocabulary={{ source: 'i18n', fields: 'all' }}>
        <FieldRow
          label={t('settings.language.funnyYue.label', 'Cantonese funny level').primary}
          control={
            <FunnyLevelSlider
              value={funnyLevelYue}
              ariaLabel="Cantonese funny level, 1 to 10"
              onChange={(v) => updateIfAllowed({ funnyLevelYue: v })}
            />
          }
        />
      </SearchableRow>

      <p className="text-[12px] leading-relaxed text-muted-2">
        {t(
          'settings.language.funnyEn.provenance',
          funnyLevelEn === baseFunnyLevelEn
            ? 'English saved value: level {level}.'
            : 'English scheduled value: level {level}; saved value remains level {base}.',
          { level: String(funnyLevelEn), base: String(baseFunnyLevelEn) }
        ).primary}
        {' '}
        {t(
          'settings.language.funnyYue.provenance',
          funnyLevelYue === baseFunnyLevelYue
            ? 'Cantonese saved value: level {level}.'
            : 'Cantonese scheduled value: level {level}; saved value remains level {base}.',
          { level: String(funnyLevelYue), base: String(baseFunnyLevelYue) }
        ).primary}
      </p>

      {/* Disclosure — required, not optional decoration: states plainly that the sliders style
          tone (including errors/warnings) and never facts, and that the choice can change any
          time. Shown at both levels of description density so it can't be missed by resizing a
          slider past it. */}
      <p className="text-[12px] leading-relaxed text-muted-2">
        {t(
          'settings.language.disclosure',
          'Levels 1 through 10 change the tone of every message, including errors and warnings — never the facts inside them. New installations start at level 10 for both languages. Change or reset either value at any time.'
        ).primary}
      </p>

      <SearchableRow {...mappedRows.emoji} resolvedVocabulary={{ source: 'i18n', fields: 'all' }}>
        <FieldRow
          label={t('settings.language.emoji.label', 'Show emojis in dialogs and message boxes').primary}
          description={
            t(
              'settings.language.emoji.description',
              'Adds a relevant decoration to dialogs and message boxes; never appears in buttons, labels, or other control text.'
            ).primary
          }
          control={
            <Switch
              checked={showEmojiInDialogs}
              ariaLabel="Show emojis in dialogs and message boxes"
              onChange={(v) => updateIfAllowed({ showEmojiInDialogs: v })}
            />
          }
        />
      </SearchableRow>

      <SectionReset
        keys={LANGUAGE_RESET_KEYS}
        label="Reset language settings"
        what="language mode and funny levels"
      />
    </SettingsSection>
  )
}
