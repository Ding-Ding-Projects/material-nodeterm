import { useSettings } from '../../../state/settings'
import { useI18n } from '@renderer/lib/i18n'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Switch } from '@renderer/ui/Switch'
import {
  FOCUS_DIM_MAX,
  FOCUS_DIM_MIN,
  MOMENTUM_MAX_MINUTES,
  MOMENTUM_MIN_MINUTES,
  normalizeAdhdModes
} from '@renderer/lib/adhdModes'
import type { AdhdModes } from '@shared/types'
import { Slider } from '@renderer/ui/md3'

/**
 * The ADHD modes settings surface.
 *
 * Every mode is named for what it DOES rather than who it is for, so a person can switch one on
 * without disclosing anything to a colleague reading over their shoulder. Nothing here is presented
 * as medical: these are interface accommodations, not assessment, diagnosis or advice, and the copy
 * says so once, plainly, rather than hedging in every row.
 *
 * The rows are five independent switches, never a master toggle — see `lib/adhdModes.ts` for why
 * that is the load-bearing decision rather than a layout preference.
 */

const ROWS = {
  focus: {
    title: 'Focus',
    keywords: ['adhd', 'focus', 'spotlight', 'dim', 'highlight', 'attention', 'distraction']
  },
  lowStimulation: {
    title: 'Low stimulation',
    keywords: [
      'adhd',
      'low',
      'stimulation',
      'quiet',
      'calm',
      'motion',
      'animation',
      'reduce',
      'sensory',
      'overwhelm'
    ]
  },
  timeAwareness: {
    title: 'Time awareness',
    keywords: ['adhd', 'time', 'elapsed', 'clock', 'blindness', 'duration', 'how long']
  },
  oneThing: {
    title: 'One thing at a time',
    keywords: ['adhd', 'one', 'thing', 'next', 'action', 'task', 'current', 'single']
  },
  momentum: {
    title: 'Momentum',
    keywords: ['adhd', 'momentum', 'nudge', 'idle', 'stuck', 'reminder', 'untouched']
  }
}
const ENTRIES = Object.values(ROWS)

export function AdhdModesSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const { t } = useI18n()
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const modes = normalizeAdhdModes(settings.adhdModes)

  const set = (patch: Partial<AdhdModes>): void => {
    update({ adhdModes: { ...modes, ...patch } })
  }

  const title = t('settings.section.adhdModes', 'ADHD modes')
  const description = t(
    'settings.adhdModes.description',
    'Five things you can switch on independently. They change how the interface behaves, nothing else — they are not a diagnosis, an assessment or advice, and nothing here is recorded or sent anywhere.'
  )

  return (
    <SettingsSection
      id="adhd-modes"
      vocabularyApplied
      title={title.primary}
      description={
        description.secondary
          ? `${description.primary} ${description.secondary}`
          : description.primary
      }
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.focus}>
        <FieldRow
          label={t('settings.adhdModes.focus.label', 'Focus').primary}
          description={
            t(
              'settings.adhdModes.focus.hint',
              'Fades everything except the node you are working in. It only dims — nothing is hidden, and every node stays clickable.'
            ).primary
          }
          control={
            <Switch
              checked={modes.focus}
              onChange={(v) => set({ focus: v })}
              ariaLabel="Focus mode"
            />
          }
        />
        {modes.focus ? (
          <FieldRow
            label={t('settings.adhdModes.focusDim.label', 'How much to fade').primary}
            description={
              t(
                'settings.adhdModes.focusDim.hint',
                'Even at the strongest setting an unfocused node stays visible.'
              ).primary
            }
            control={
              <Slider
                className="adhd-range"
                min={FOCUS_DIM_MIN}
                max={FOCUS_DIM_MAX}
                step={0.05}
                value={modes.focusDim}
                aria-label="How much to fade unfocused nodes"
                onChange={(e) => set({ focusDim: Number(e.target.value) })}
              />
            }
          />
        ) : null}
      </SearchableRow>

      <SearchableRow {...ROWS.lowStimulation}>
        <FieldRow
          label={t('settings.adhdModes.lowStimulation.label', 'Low stimulation').primary}
          description={
            t(
              'settings.adhdModes.lowStimulation.hint',
              'Less motion and quieter colour. Notifications reduce to the ones that need an answer — an agent waiting on you still interrupts.'
            ).primary
          }
          control={
            <Switch
              checked={modes.lowStimulation}
              onChange={(v) => set({ lowStimulation: v })}
              ariaLabel="Low stimulation mode"
            />
          }
        />
      </SearchableRow>

      <SearchableRow {...ROWS.timeAwareness}>
        <FieldRow
          label={t('settings.adhdModes.timeAwareness.label', 'Time awareness').primary}
          description={
            t(
              'settings.adhdModes.timeAwareness.hint',
              'Shows how long a session has been open and how long since anything changed, on the node itself rather than in a menu.'
            ).primary
          }
          control={
            <Switch
              checked={modes.timeAwareness}
              onChange={(v) => set({ timeAwareness: v })}
              ariaLabel="Time awareness mode"
            />
          }
        />
      </SearchableRow>

      <SearchableRow {...ROWS.oneThing}>
        <FieldRow
          label={t('settings.adhdModes.oneThing.label', 'One thing at a time').primary}
          description={
            t(
              'settings.adhdModes.oneThing.hint',
              'Keeps one next action visible on the canvas. You write it; nothing guesses it for you.'
            ).primary
          }
          control={
            <Switch
              checked={modes.oneThing}
              onChange={(v) => set({ oneThing: v })}
              ariaLabel="One thing at a time mode"
            />
          }
        />
        {modes.oneThing ? (
          <FieldRow
            label={t('settings.adhdModes.oneThingText.label', 'Right now I am').primary}
            control={
              <input
                className="adhd-text"
                type="text"
                value={modes.oneThingText}
                maxLength={200}
                placeholder="…"
                aria-label="Your current next action"
                onChange={(e) => set({ oneThingText: e.target.value })}
              />
            }
          />
        ) : null}
      </SearchableRow>

      <SearchableRow {...ROWS.momentum}>
        <FieldRow
          label={t('settings.adhdModes.momentum.label', 'Momentum').primary}
          description={
            t(
              'settings.adhdModes.momentum.hint',
              'Notes when a node has sat untouched for a while. It states the elapsed time and nothing else, and "not now" is respected for 30 minutes.'
            ).primary
          }
          control={
            <Switch
              checked={modes.momentum}
              onChange={(v) => set({ momentum: v })}
              ariaLabel="Momentum mode"
            />
          }
        />
        {modes.momentum ? (
          <FieldRow
            label={t('settings.adhdModes.momentumMinutes.label', 'After how long').primary}
            control={
              <input
                className="adhd-number"
                type="number"
                min={MOMENTUM_MIN_MINUTES}
                max={MOMENTUM_MAX_MINUTES}
                step={5}
                value={modes.momentumMinutes}
                aria-label="Minutes untouched before the momentum note appears"
                onChange={(e) => set({ momentumMinutes: Number(e.target.value) })}
              />
            }
          />
        ) : null}
      </SearchableRow>
    </SettingsSection>
  )
}
