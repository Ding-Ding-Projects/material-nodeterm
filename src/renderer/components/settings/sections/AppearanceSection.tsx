import { useEffect, useState } from 'react'
import { useSettings } from '../../../state/settings'
import { RAINBOW_SPEED_MAX, RAINBOW_SPEED_MIN, rainbowDurationSeconds } from '../../../lib/nodeColor'
import { NODE_COLORS } from '../../../state/workspace'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'
import { FieldRow } from '../FieldRow'
import { Switch } from '@renderer/ui/Switch'
import { SegmentedPill } from '@renderer/ui/SegmentedPill'
import { useToyLocks } from '../../../state/toylocks'
import { LockWizard } from '../../toylocks/LockWizard'
import { UnlockPrompt } from '../../toylocks/UnlockPrompt'
import {
  HIDEABLE_HEADER_BUTTONS,
  HIDEABLE_MENU_ITEMS,
  isHidden,
  type HideableRow
} from '@renderer/lib/ui-visibility'
import { cn } from '@renderer/ui/cn'
import { SectionReset } from '../SectionReset'
import { APPEARANCE_RESET_KEYS } from '@renderer/lib/settingsReset'

const ROWS = {
  appTheme: {
    title: 'Appearance',
    keywords: ['appearance', 'theme', 'light', 'dark', 'mode', 'colour', 'color', 'chrome']
  },
  accent: { title: 'Accent', keywords: ['accent', 'color', 'theme', 'appearance'] },
  rainbowSpeed: {
    title: 'Rainbow speed',
    keywords: ['rainbow', 'colour', 'color', 'animation', 'speed', 'cycle', 'motion']
  },
  menuItems: {
    title: 'Node menu items',
    keywords: ['menu', 'context', 'right click', 'items', 'hide']
  },
  headerButtons: {
    title: 'Terminal header buttons',
    keywords: ['terminal', 'header', 'buttons', 'icons', 'hide']
  },
  reset: {
    title: 'Reset appearance',
    keywords: ['reset', 'default', 'defaults', 'factory', 'restore', 'revert', 'undo']
  }
}
const ENTRIES = Object.values(ROWS)

/** Settings store what is HIDDEN, the switches say "show" — so showing drops the id and hiding
 *  appends it. Filtering first also keeps a hand-edited list free of duplicates. */
function withShown(hidden: readonly string[], id: string, shown: boolean): string[] {
  const next = hidden.filter((h) => h !== id)
  if (!shown) next.push(id)
  return next
}

/** One switch per hideable row, checked when the row is visible. */
function VisibilityToggles({
  rows,
  hidden,
  where,
  onChange
}: {
  rows: readonly HideableRow[]
  hidden: readonly string[]
  /** Completes the aria-label ("Show Duplicate in the node menu") — the label alone is ambiguous
   *  once both lists are on screen and a screen reader reads them out of context. */
  where: string
  onChange: (next: string[]) => void
}): React.JSX.Element {
  return (
    <div className="mt-3 space-y-3 border-l border-border pl-4">
      {rows.map((row) => (
        <FieldRow
          key={row.id}
          label={row.label}
          control={
            <Switch
              checked={!isHidden(row.id, hidden)}
              onChange={(shown) => onChange(withShown(hidden, row.id, shown))}
              ariaLabel={`Show ${row.label} ${where}`}
            />
          }
        />
      ))}
    </div>
  )
}

/** The one "appearance value" toy locks ship on today — see docs/toy-locks.md for how to extend
 *  the same `useToyLock`-style pattern to another appearance control. */
const ACCENT_TARGET = { kind: 'appearance' as const, id: 'accent', label: 'Accent colour' }

export function AppearanceSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  // `base`, not the effective `settings` — see TerminalSection's identical note; this section
  // edits the saved preference, never the currently-applied scheduled override.
  const appTheme = useSettings((s) => s.base.appTheme)
  const accent = useSettings((s) => s.base.accent)
  const hiddenNodeMenuItems = useSettings((s) => s.base.hiddenNodeMenuItems)
  const hiddenHeaderButtons = useSettings((s) => s.base.hiddenHeaderButtons)
  const rainbowSpeed = useSettings((s) => s.base.rainbowSpeed)
  const update = useSettings((s) => s.update)

  const lockRecords = useToyLocks((s) => s.records)
  const unlockedUntil = useToyLocks((s) => s.unlockedUntil)
  useEffect(() => {
    void useToyLocks.getState().refresh()
  }, [])
  const accentLock = lockRecords.find((r) => r.target.kind === 'appearance' && r.target.id === 'accent')
  const accentLocked = !!accentLock && !(unlockedUntil[accentLock.id] !== undefined && Date.now() < unlockedUntil[accentLock.id])
  const [lockWizardAnchor, setLockWizardAnchor] = useState<{ x: number; y: number } | null>(null)
  const [unlockAnchor, setUnlockAnchor] = useState<{ x: number; y: number } | null>(null)

  // 'session' duration re-locks the moment this settings section is left (the closest thing an
  // appearance CONTROL has to "leaving the surface" — see ToyLockDurationMode's doc comment).
  useEffect(() => {
    if (isActive || !accentLock || accentLock.duration !== 'session') return
    useToyLocks.getState().relock(accentLock.id)
    // Only fires on the active→inactive transition, not on every accentLock identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive])

  return (
    <SettingsSection
      id="appearance"
      title="Appearance"
      isActive={isActive}
      searchEntries={ENTRIES}
    >
      <SearchableRow {...ROWS.appTheme}>
        <FieldRow
          label="Appearance"
          description="Follow terminal theme uses the colour theme you picked in Settings → Terminal, so a light terminal isn't framed by a dark window."
          control={
            <SegmentedPill
              value={appTheme}
              options={[
                { value: 'auto', label: 'Follow terminal' },
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' }
              ]}
              onChange={(v) => update({ appTheme: v })}
              ariaLabel="Appearance"
            />
          }
        />
      </SearchableRow>
      <SearchableRow {...ROWS.rainbowSpeed}>
        <div className="flex items-center justify-between gap-4 py-2.5">
          <span className="text-[13px] text-text">
            Rainbow speed
            {/* Says what the control governs AND what overrides it. A user who has reduced
                motion on would otherwise drag this and see nothing change, and conclude the
                setting is broken rather than deferring to them. */}
            <span className="block text-[11px] text-text-secondary">
              How fast a rainbow node colour cycles. Held at one colour while the system asks for
              reduced motion.
            </span>
          </span>
          <input
            type="range"
            min={RAINBOW_SPEED_MIN}
            max={RAINBOW_SPEED_MAX}
            step={1}
            value={rainbowSpeed}
            aria-label="Rainbow speed"
            aria-valuetext={`Level ${rainbowSpeed} of ${RAINBOW_SPEED_MAX}, one cycle every ${rainbowDurationSeconds(rainbowSpeed)} seconds`}
            onChange={(e) => update({ rainbowSpeed: Number(e.target.value) })}
          />
        </div>
      </SearchableRow>
      <SearchableRow {...ROWS.accent}>
        <div className="flex items-center justify-between gap-4 py-2.5">
          <span className="text-[13px] text-text">Accent</span>
          {accentLocked ? (
            <button
              type="button"
              className="toylock-btn toylock-btn--sm"
              onClick={(e) => setUnlockAnchor({ x: e.clientX, y: e.clientY })}
            >
              🔒 Locked — click to unlock
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {NODE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Accent ${c}`}
                  onClick={() => update({ accent: c })}
                  style={{ background: c }}
                  className={cn(
                    'size-6 rounded-full border-2',
                    accent === c ? 'border-text' : 'border-transparent'
                  )}
                />
              ))}
              <button
                type="button"
                className="toylock-btn toylock-btn--sm"
                onClick={(e) => (accentLock ? setUnlockAnchor({ x: e.clientX, y: e.clientY }) : setLockWizardAnchor({ x: e.clientX, y: e.clientY }))}
              >
                {accentLock ? 'Manage lock…' : 'Lock this…'}
              </button>
            </div>
          )}
        </div>
      </SearchableRow>
      {/* One wrapper element per row: the section body puts a divider and its own padding around
          every direct child, so a heading + caption + list must arrive as a single node. */}
      <SearchableRow {...ROWS.menuItems}>
        <div>
          <h4 className="text-[13px] font-medium text-text">Node menu items</h4>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Which rows the node right-click menu offers (and, for Colors, the group frame's colour
            strip too) — it applies to the next right-click. Destructive and recovery actions
            (Delete, Restart agent) are never hidden here.
          </p>
          <VisibilityToggles
            rows={HIDEABLE_MENU_ITEMS}
            hidden={hiddenNodeMenuItems}
            where="in the node menu"
            onChange={(next) => update({ hiddenNodeMenuItems: next })}
          />
        </div>
      </SearchableRow>
      <SearchableRow {...ROWS.headerButtons}>
        <div>
          <h4 className="text-[13px] font-medium text-text">Terminal header buttons</h4>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Which icon buttons the terminal node header shows. Close and the terminal Search
            button are always shown, as are the right-click menu's destructive and recovery
            actions (Delete, Restart agent).
          </p>
          <VisibilityToggles
            rows={HIDEABLE_HEADER_BUTTONS}
            hidden={hiddenHeaderButtons}
            where="in the terminal header"
            onChange={(next) => update({ hiddenHeaderButtons: next })}
          />
        </div>
      </SearchableRow>
      <SearchableRow {...ROWS.reset}>
        <SectionReset
          keys={APPEARANCE_RESET_KEYS}
          label="Reset appearance"
          what="the appearance settings"
        />
      </SearchableRow>

      {lockWizardAnchor && (
        <LockWizard target={ACCENT_TARGET} anchor={lockWizardAnchor} onClose={() => setLockWizardAnchor(null)} />
      )}
      {unlockAnchor && accentLock && (
        <UnlockPrompt
          record={accentLock}
          anchor={unlockAnchor}
          onClose={() => setUnlockAnchor(null)}
          onUnlocked={() => setUnlockAnchor(null)}
        />
      )}
    </SettingsSection>
  )
}
