import { MaterialSymbol } from './MaterialSymbol'
import { useSettings } from '../state/settings'
import { formatElapsed, momentumNudge, normalizeAdhdModes, snoozeUntil, SNOOZE_MINUTES } from '../lib/adhdModes'
import { nodeActivity, useActivityTick } from '../lib/nodeActivity'
import { Button } from '@renderer/ui/md3'

/**
 * The two ADHD modes that render ON a node rather than in a settings page: TIME AWARENESS and
 * MOMENTUM.
 *
 * They live here, apart from the terminal node, for two reasons. A clock in a menu does not help
 * time blindness, so both have to sit where the work is — and `TerminalNode.tsx` is five thousand
 * lines of xterm and PTY lifecycle that nothing can render in a test. Extracted, they are the real
 * production components a behavioural test can mount directly, so "the setting gates the readout"
 * and "the decision reaches a render" are assertions about what ships rather than about a copy.
 *
 * Both read `lib/adhdModes.ts` for every decision and `lib/nodeActivity.ts` for the numbers. Neither
 * decides anything itself; neither renders anything at all while its mode is off.
 */

/**
 * Timestamps a surface needs, resolved once so both components read the clock the same way.
 *
 * `tick` governs the SUBSCRIPTION and nothing else — with it false no interval is started, but the
 * data is still returned exactly as recorded. Nulling the data out here as well would give each
 * component two independent reasons to render nothing, and a guard that is enforced twice is a
 * guard whose test cannot fail: removing either one on purpose leaves the suite green, which is how
 * a gate quietly stops being one. Each component states its own gate, once.
 */
function useNodeTimes(nodeId: string, tick: boolean): {
  openedAt: number | null
  lastActivityAt: number | null
  now: number
} {
  // The ONE shared minute ticker. `tick: false` subscribes to nothing at all, so a person with
  // these modes off pays for no timer — see nodeActivity.ts.
  useActivityTick(tick)
  const entry = nodeActivity(nodeId)
  return {
    openedAt: entry?.openedAt ?? null,
    lastActivityAt: entry?.lastActivityAt ?? null,
    now: Date.now()
  }
}

/**
 * TIME AWARENESS — how long since anything happened in this node, worn as a header chip.
 *
 * States a number and stops. It never changes colour, never becomes urgent, and carries no verdict:
 * "40 min" is a fact, and anything about what forty minutes MEANS is this feature deciding
 * something about the person that it has no standing to decide.
 *
 * The tooltip carries the second fact the contract asks for — how long the session has been open —
 * worded as "in this window" because that is the only version of it the app can honestly claim. A
 * relaunch reattaches a tmux session that may be days old.
 */
export function AdhdElapsedChip({ nodeId }: { nodeId: string }): React.JSX.Element | null {
  const modes = normalizeAdhdModes(useSettings((s) => s.settings.adhdModes))
  const { openedAt, lastActivityAt, now } = useNodeTimes(nodeId, modes.timeAwareness)
  if (!modes.timeAwareness) return null
  if (lastActivityAt === null) return null

  const since = formatElapsed(now - lastActivityAt)
  if (!since) return null
  const open = openedAt === null ? '' : formatElapsed(now - openedAt)
  const title = open
    ? `Last change ${since} ago. Session open in this window for ${open}.`
    : `Last change ${since} ago.`

  return (
    <span className="adhd-elapsed" title={title}>
      <MaterialSymbol name="schedule" size={12} />
      {since}
      {/* The visible chip is deliberately terse; a screen reader would otherwise be read "41 min"
        with no idea what of. The full sentence goes in a visually-hidden span rather than an
        aria-label on the wrapper, which browsers do not reliably expose on a generic element — and
        NOT in a live region, because announcing the number every minute is the nagging this whole
        feature refuses to do. */}
      <span className="sr-only">{title}</span>
    </span>
  )
}

/**
 * MOMENTUM — a dismissible note when a node has sat untouched past the chosen window.
 *
 * Non-blocking by construction: it is a `role="status"` region, so a screen reader mentions it
 * politely and nothing takes focus; nothing here autofocuses, and nothing animates, so there is no
 * motion for `prefers-reduced-motion` (or low stimulation's motion scale) to have to suppress. The
 * container ignores the pointer entirely and only the "Not now" button accepts a click — it floats
 * over a live terminal, and eating a drag there would cost the user a text selection.
 *
 * "Not now" writes a real timestamp (`snoozeUntil`), so it is respected for the stated period rather
 * than until the next render. The snooze is one setting, not one per node: a person who says "not
 * now" means it, and quieting only the node they happened to click would leave the other fourteen
 * still talking.
 */
export function AdhdMomentumNote({ nodeId }: { nodeId: string }): React.JSX.Element | null {
  const modes = normalizeAdhdModes(useSettings((s) => s.settings.adhdModes))
  const update = useSettings((s) => s.update)
  const { lastActivityAt, now } = useNodeTimes(nodeId, modes.momentum)
  const decision = momentumNudge(modes, lastActivityAt, now)
  if (!decision.show) return null

  return (
    <div className="adhd-momentum nodrag" role="status">
      <span>{decision.text}</span>
      <Button variant="outlined" size="small" vocabularyMode="factual"
        type="button"
        className="adhd-momentum__dismiss"
        title={`Stay quiet for ${SNOOZE_MINUTES} minutes`}
        onClick={() =>
          update({ adhdModes: { ...modes, snoozeUntilMs: snoozeUntil(Date.now()) } })
        }
      >
        Not now
      </Button>
    </div>
  )
}
