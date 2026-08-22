import { allowsNotification, normalizeAdhdModes } from './adhdModes'
import { useSettings } from '../state/settings'
import {
  useNotifications,
  type NotificationKind,
  type PushNotificationInput
} from '../state/notifications'

/**
 * The one funnel every in-app notification passes through so LOW STIMULATION can quiet the ones
 * that do not need a person.
 *
 * It exists as a module rather than as a branch at each call site because the alternative is
 * reclassifying notifications ad hoc — sixteen small judgements, each individually plausible, that
 * drift apart until the mode silences something it must not. `adhdKindForNotification` is the ONE
 * judgement, made from the kind the call site already declares.
 *
 * `lib/adhdModes.ts` stays pure and knows nothing about the store; this is the thin wiring that
 * joins its decision to the two stores involved.
 */

/**
 * Map the app's own notification kind onto the ADHD classification.
 *
 * Not invented for this: the notifications store already decides that `warning` and `error`
 * persist until a person dismisses them (`defaultAutoDismissMs` returns `null` for exactly those
 * two) while everything else times out on its own. So the store has already said which kinds need
 * a human, and this reads that back rather than making a second, quietly different call.
 *
 *   error / warning -> needs-you      a failed transfer, a refused restart, a blocked action
 *   success         -> done           something finished; the fact survives in the centre
 *   info / progress -> informational  narration of work in flight
 */
export function adhdKindForNotification(
  kind: NotificationKind
): 'needs-you' | 'done' | 'informational' {
  if (kind === 'error' || kind === 'warning') return 'needs-you'
  if (kind === 'success') return 'done'
  return 'informational'
}

/**
 * Push a notification, respecting low stimulation.
 *
 * A quieted notification is NOT destroyed — it is pushed already dismissed, so it never appears as
 * a toast but is still in the notification centre, still unread, still counted by the bell. Low
 * stimulation removes the interruption, not the information; deleting the record would make the
 * mode cost the user something, which is the failure the whole design is arranged to avoid.
 *
 * Returns the notification's id exactly as the raw store does, so callers cannot tell the
 * difference and none of them has to care.
 */
export function notify(input: PushNotificationInput): string {
  const modes = normalizeAdhdModes(useSettings.getState().settings.adhdModes)
  const allowed = allowsNotification(modes, adhdKindForNotification(input.kind))
  return useNotifications.getState().push(allowed ? input : { ...input, silent: true })
}
