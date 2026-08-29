import type { SessionIcon } from '@shared/session-icon'
import { sanitizeSessionIcon } from '@shared/session-icon'

export function SessionIconGlyph({ icon, size = 22, title }: { icon?: SessionIcon; size?: number; title?: string }): JSX.Element | null {
  const safe = sanitizeSessionIcon(icon)
  if (!safe) return null
  if (safe.type === 'emoji') return <span className="session-icon session-icon--emoji" title={title} aria-hidden>{safe.emoji}</span>
  return <img className="session-icon session-icon--image" src={safe.dataUrl} width={size} height={size} alt={title ?? 'Session icon'} title={title} />
}
