import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../cn'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

export type SnackbarTone = 'info' | 'success' | 'progress' | 'warning' | 'error'

export interface SnackbarAction {
  label: string
  onClick: () => void
}

export interface SnackbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: SnackbarTone
  /** Leading glyph; the tone alone must never be the only signal. */
  icon?: ReactNode
  title: ReactNode
  text?: ReactNode
  actions?: readonly SnackbarAction[]
  /** Rendered as the × button; omitted = no dismiss affordance. */
  onDismiss?: () => void
  /** Accessible name for the dismiss button; authored, mapped through the vocabulary. */
  dismissLabel?: string
  /** Visually hidden prefix read before the title ("Error: "), kept OUT of the title element so
   *  the visible title stays the exact fact it was given. */
  srPrefix?: string
}

/**
 * One transient message. Presentational only: timers, read-marking and stacking order belong to
 * the caller (`NotificationToasts`, the easter-egg cabinet). Mount inside a `.mdx-snackbar-stack`
 * so the fixed bottom-left placement and the dialog inset apply.
 */
export function Snackbar({
  tone = 'info',
  icon,
  title,
  text,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  srPrefix,
  className,
  ...rest
}: SnackbarProps): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const urgent = tone === 'error' || tone === 'warning'
  return (
    <div
      className={cn('mdx-snackbar', tone !== 'info' && `mdx-snackbar--${tone}`, className)}
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      {...rest}
    >
      {icon && <span className="mdx-snackbar__icon" aria-hidden>{icon}</span>}
      <div className="mdx-snackbar__body">
        {srPrefix && <span className="sr-only">{srPrefix}</span>}
        <div className="mdx-snackbar__title">{title}</div>
        {text && <div className="mdx-snackbar__text">{text}</div>}
        {actions && actions.length > 0 && (
          <div className="mdx-snackbar__actions">
            {actions.map((action, index) => (
              <button key={index} type="button" className="mdx-snackbar__action" onClick={action.onClick}>
                {vocab(action.label)}
              </button>
            ))}
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="mdx-snackbar__dismiss"
          aria-label={vocab(dismissLabel)}
          title={vocab(dismissLabel)}
          onClick={onDismiss}
        >
          ×
        </button>
      )}
    </div>
  )
}

/** The fixed bottom-left stack every snackbar mounts into. */
export function SnackbarStack({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className={cn('mdx-snackbar-stack', className)} {...rest}>
      {children}
    </div>
  )
}
