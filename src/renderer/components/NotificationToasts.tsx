import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  useNotifications,
  selectActiveToasts,
  type AppNotification,
  type NotificationKind
} from '../state/notifications'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

const KIND_ICON: Record<NotificationKind, string> = {
  info: 'ℹ',
  success: '✓',
  progress: '⋯',
  warning: '⚠',
  error: '✕'
}

const KIND_LABEL: Record<NotificationKind, string> = {
  info: 'Info',
  success: 'Success',
  progress: 'In progress',
  warning: 'Warning',
  error: 'Error'
}

function Toast({ n }: { n: AppNotification }): React.JSX.Element {
  const dismiss = useNotifications((s) => s.dismiss)
  const markRead = useNotifications((s) => s.markRead)
  // Personal-vocabulary boundary: a toast is the app talking to the user, and every notification
  // pushed anywhere in the renderer surfaces through this one component, so translating here is
  // what reaches all of them.
  //
  // `title` and the action labels are authored prose. A body is fact text by default, because push
  // sites commonly pass `error.message`, an assessment reason, a git failure string, or a clipped
  // agent transcript line. A producer that owns the body may opt into `bodyKind: 'authored'`; the
  // type is carried with the notification so a broad string replacement cannot rewrite host facts.
  const vocab = useVocabularyMapper()
  const title = n.titleKind === 'authored' ? vocab(n.title) : n.title
  const body = n.bodyKind === 'authored' && n.body ? vocab(n.body) : n.body
  // One source for the visible × and its accessible name, so a screen reader and the screen never
  // announce two different words for the same button.
  const dismissLabel = vocab('Dismiss')

  // Auto-dismiss on a per-toast timer. Errors and warnings carry `autoDismissMs: null` and
  // never get one — they persist until the user (or the notification centre) dismisses them.
  useEffect(() => {
    if (n.autoDismissMs == null) return
    const t = window.setTimeout(() => dismiss(n.id), n.autoDismissMs)
    return () => window.clearTimeout(t)
    // Re-arm only if the id or the timeout itself changes — not on every store tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id, n.autoDismissMs])

  useEffect(() => {
    // A toast that's been on screen a moment counts as "seen" for the unread badge, even if the
    // user never opens the notification centre.
    const t = window.setTimeout(() => markRead(n.id), 1200)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id])

  return (
    <div
      className={`toast toast--${n.kind}`}
      role={n.kind === 'error' || n.kind === 'warning' ? 'alert' : 'status'}
      aria-live={n.kind === 'error' || n.kind === 'warning' ? 'assertive' : 'polite'}
    >
      <span className="toast__icon" aria-hidden>
        {KIND_ICON[n.kind]}
      </span>
      <div className="toast__body">
        <span className="sr-only">{vocab(KIND_LABEL[n.kind])}: </span>
        <div className="toast__title">{title}</div>
        {body && <div className="toast__text">{body}</div>}
        {n.actions && n.actions.length > 0 && (
          <div className="toast__actions">
            {n.actions.map((a, i) => (
              <button
                key={i}
                className="toast__action"
                onClick={() => {
                  a.onClick()
                  dismiss(n.id)
                }}
              >
                {vocab(a.label)}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        className="toast__dismiss"
        aria-label={`${dismissLabel}: ${title}`}
        title={dismissLabel}
        onClick={() => dismiss(n.id)}
      >
        ×
      </button>
    </div>
  )
}

/**
 * Corner-anchored, non-blocking toast stack. Mounted once at the app root (see App.tsx) —
 * NEVER a modal dialog: informational/success/progress/non-decision-error messages surface
 * here, not as a `ConfirmDialog`. Reserve that for decisions the user must make before
 * continuing.
 *
 * Bottom-left: it is the one screen corner with nothing else fixed-positioned in it. The
 * auto-update card lives bottom-right (`.update-card`); the notification-centre trigger (the
 * bell) lives in the top-right controls cluster; the dock, sessions-icon cluster, and canvas
 * pills are all positioned relative to `.flow-wrap`, not the viewport. A toast never has to
 * fight another surface for the same pixels.
 */
export function NotificationToasts(): React.JSX.Element | null {
  const items = useNotifications((s) => s.items)
  const active = selectActiveToasts(items)
  // Resolved before the early return — a hook after `if (... ) return null` would change hook
  // order the first time the stack empties.
  const stackLabel = useVocabularyMapper()('Notifications')
  if (active.length === 0) return null
  return createPortal(
    <div className="toast-stack" aria-label={stackLabel}>
      {/* Newest at the bottom (closest to where the corner "grows"), oldest scrolls up and out —
          the stack itself scrolls if it ever grows past the viewport rather than clipping. */}
      {active
        .slice()
        .reverse()
        .map((n) => (
          <Toast key={n.id} n={n} />
        ))}
    </div>,
    document.body
  )
}
