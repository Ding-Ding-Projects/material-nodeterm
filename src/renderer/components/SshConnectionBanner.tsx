import type { SshProjectStatus } from '@shared/types'
import { Button } from '@renderer/ui/md3'
import { useI18n } from '../lib/i18n'

/**
 * The thin per-project SSH connection strip under the app bar. Its own component so Canvas.tsx (a
 * hot file every branch touches) only decides WHEN it shows; WHAT it says and how it looks live
 * here, on Material 3 tokens.
 *
 * Two independent facts can raise it:
 *  - the ControlMaster's own state (connecting / reconnecting / disconnected / error), and
 *  - `hooksLost`: the master is fine but the reverse hook tunnel stopped answering a second
 *    liveness probe in a row (`shouldReportTunnelLost`), so agent status and canvas control are
 *    deaf until the watchdog's repair lands. That state never offers Reconnect: nothing the user
 *    can click is faster than the repair already in flight, and a reconnect would cost them every
 *    terminal for no gain.
 */
export interface SshConnectionBannerProps {
  label: string
  /** `user@host`, the strip's tooltip. */
  endpoint: string
  /** Absent until the project's first status event. */
  status?: SshProjectStatus
  /** The one line ssh printed with an `error` status, already trimmed by main. */
  cause?: string
  hooksLost?: boolean
  onReconnect: () => void
}

export type SshBannerTone = 'progress' | 'warning' | 'error'

/** Pure: which strip, if any, a status pair calls for. `null` = say nothing. */
export function sshBannerTone(status: SshProjectStatus | undefined, hooksLost: boolean): SshBannerTone | null {
  if (!status) return null
  if (status === 'connected') return hooksLost ? 'warning' : null
  return status === 'error' || status === 'disconnected' ? 'error' : 'progress'
}

export function SshConnectionBanner({
  label,
  endpoint,
  status,
  cause,
  hooksLost = false,
  onReconnect
}: SshConnectionBannerProps): React.JSX.Element | null {
  const { ts } = useI18n()
  const tone = sshBannerTone(status, hooksLost)
  if (!tone) return null
  const text =
    tone === 'warning'
      ? ts('ssh.banner.hooksLost', '{label}: Agent status and canvas control lost their verified connection. Retrying automatically…', { label })
      : status === 'connecting'
        ? ts('ssh.banner.connecting', 'Connecting to {label}…', { label })
        : status === 'reconnecting'
          ? ts('ssh.banner.reconnecting', 'Reconnecting to {label}…', { label })
          : status === 'disconnected'
            ? ts('ssh.banner.disconnected', 'Disconnected from {label}', { label })
            : cause
              ? ts('ssh.banner.errorCause', '{label}: {cause}', { label, cause })
              : ts('ssh.banner.error', 'SSH connection error: {label}', { label })
  return (
    <div className={`md3-ssh-banner md3-ssh-banner--${tone}`} role="status" aria-live="polite" title={endpoint}>
      {tone === 'progress' ? (
        // A wait that can legitimately sit for minutes (passphrase prompt, slow host) reads as
        // in progress rather than hung.
        <span className="ui-spinner" aria-hidden />
      ) : (
        <span className="md3-ssh-banner__dot" aria-hidden />
      )}
      <span className="md3-ssh-banner__text">{text}</span>
      {/* Reconnect runs the SAME attempt the auto-loop makes, jumping its backoff. Hidden while an
          attempt is in flight, and for a lost hook tunnel (see the component comment). */}
      {tone === 'error' && (
        <Button variant="tonal" size="small" className="md3-ssh-banner__retry" vocabularyMode="factual" onClick={onReconnect}>
          {ts('ssh.banner.reconnect', 'Reconnect')}
        </Button>
      )}
    </div>
  )
}
