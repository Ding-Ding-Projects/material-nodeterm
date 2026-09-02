import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ServerDeploymentStage } from '@shared/types'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { Button } from '@renderer/ui/md3'

type DeploymentState = 'starting' | 'ready' | 'docker-restart-required' | 'failed'

/** Map the authored accessibility prefix without ever passing the live access code through the
 * vocabulary table. */
export function phonePairCodeLabel(code: string, vocab: (text: string) => string): string {
  return `${vocab('Current TOTP code')} ${code}`
}

/** One human-readable line per stage, in the order they can occur (not every deployment passes
 *  through every one — see the doc comment on `ServerDeploymentStage`). This is what turns the
 *  popover from a spinner (indistinguishable from a hang) into real progress: the user sees WHICH
 *  step is running, not just that something is. */
const STAGE_LABEL: Record<ServerDeploymentStage, string> = {
  'preparing-secrets': 'Preparing the first-boot access code…',
  'checking-docker': 'Checking for Docker…',
  'installing-docker': 'Installing Docker Desktop… this can take several minutes.',
  'starting-docker-daemon': 'Starting Docker Desktop… waiting for it to become ready.',
  'building-and-starting': 'Building the server image and starting it… the first build can take several minutes.',
  ready: 'Server Edition is up.'
}

/** The order stages are expected to progress in, for the "done" checklist look — a stage not in
 *  this list (there is none today) would simply not render a row, never crash. */
const STAGE_ORDER: ServerDeploymentStage[] = [
  'preparing-secrets',
  'checking-docker',
  'installing-docker',
  'starting-docker-daemon',
  'building-and-starting',
  'ready'
]

/** Copies text to the clipboard and reports success/failure via a transient icon, the same shape
 *  as `MinecraftConnectBanner`'s `AddressChip` and `SystemResourcePill`'s copy affordance. */
function CopyButton({ value, label }: { value: string; label: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const vocab = useVocabularyMapper()
  const visibleLabel = vocab(label)
  const copy = async (): Promise<void> => {
    const ok = await window.nodeTerminal.clipboard.writeText(value)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    }
  }
  return (
    <Button variant="outlined" size="small" vocabularyMode="factual"
      type="button"
      className="phone-pair__copy"
      onClick={() => void copy()}
      title={`${vocab('Copy')} ${visibleLabel.toLowerCase()}`}
    >
      <span aria-hidden="true">{copied ? '✓' : '⧉'}</span>
      <span className="sr-only">{copied ? `${visibleLabel} ${vocab('copied')}` : `${vocab('Copy')} ${visibleLabel.toLowerCase()}`}</span>
    </Button>
  )
}

/** The phone shortcut is deployment-first: it brings up the complete Server Edition site, building
 * the local image when absent. Device enrollment belongs to that site, so this surface never asks
 * for a subscription or starts the older desktop SSH/relay QR listener. */
export function PhonePairPopover({
  anchor,
  onClose,
  onOpenSettings
}: {
  anchor: { right: number; bottom: number }
  onClose: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [state, setState] = useState<DeploymentState>('starting')
  const [stage, setStage] = useState<ServerDeploymentStage>('checking-docker')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const vocab = useVocabularyMapper()

  const start = async (): Promise<void> => {
    setState('starting')
    setError('')
    const result = await window.nodeTerminal.serverDeployment.start()
    if (result.ok && result.url) {
      setUrl(result.url)
      setTotpCode(result.totpCode ?? '')
      setState('ready')
    } else {
      setError(result.error ?? 'Server Edition could not be started.')
      setState(result.state === 'docker-restart-required' ? 'docker-restart-required' : 'failed')
    }
  }

  useEffect(() => { void start() }, [])
  // Real progress, not a spinner: this popover is up for the whole in-flight `start()` call, so
  // subscribing to the same run's stages is enough — no separate correlation id is needed.
  useEffect(() => window.nodeTerminal.serverDeployment.onProgress(setStage), [])
  useEffect(() => {
    if (state !== 'ready') return
    const refresh = (): void => {
      void window.nodeTerminal.serverDeployment.currentTotp().then(setTotpCode).catch(() => undefined)
    }
    refresh()
    const timer = setInterval(refresh, 1_000)
    return () => clearInterval(timer)
  }, [state])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const stageIndex = STAGE_ORDER.indexOf(stage)

  return createPortal(
    <>
      <div className="phone-pair__backdrop" onClick={onClose} />
      <div
        className="phone-pair"
        style={{ top: anchor.bottom + 8, right: Math.max(8, window.innerWidth - anchor.right) }}
        role="dialog"
        aria-label={vocab('Server Edition deployment')}
      >
        <div className="phone-pair__title">{vocab('Open nodeterm on another device')}</div>

        {state === 'starting' ? (
          <>
            {/* A checklist of the stages actually passed through, not a fixed list — a deployment
                that skips `installing-docker` (Docker was already there) never shows that row, so
                the list only ever grows forward and never lies about a step that did not run. */}
            <ul className="phone-pair__progress" aria-live="polite">
              {STAGE_ORDER.slice(0, Math.max(stageIndex, 0) + 1).map((s, i) => (
                <li key={s} className={i < stageIndex ? 'phone-pair__progress-done' : 'phone-pair__progress-active'}>
                  <span aria-hidden="true">{i < stageIndex ? '✓' : '…'}</span> {vocab(STAGE_LABEL[s])}
                </li>
              ))}
            </ul>
          </>
        ) : state === 'ready' ? (
          <>
            <div className="phone-pair__ok">✓ {vocab('Server Edition is healthy and ready.')}</div>
            <div className="phone-pair__hint">{vocab('Use the site from this PC now. Mobile access will appear here only after its protected TOTP transport is configured.')}</div>
            {totpCode ? (
              <div className="phone-pair__row">
                <div className="phone-pair__title" aria-label={phonePairCodeLabel(totpCode, vocab)}>{totpCode}</div>
                <CopyButton value={totpCode} label="Access code" />
              </div>
            ) : null}
            <div className="phone-pair__hint">{vocab("Enter the current six-digit access code in the site's password field. It changes every 30 seconds.")}</div>
            <Button variant="outlined" size="small" vocabularyMode="factual" className="phone-pair__btn" onClick={() => void window.nodeTerminal.shell.openExternal(url)}>
              {vocab('Open Server Edition')}
            </Button>
            <div className="phone-pair__row">
              <div className="phone-pair__hint">{url}</div>
              <CopyButton value={url} label="Server address" />
            </div>
          </>
        ) : (
          <>
            <div className="phone-pair__warn">{error === 'Server Edition could not be started.' ? vocab(error) : error}</div>
            <Button variant="outlined" size="small" vocabularyMode="factual" className="phone-pair__btn" onClick={() => void start()}>
              {state === 'docker-restart-required' ? vocab('Check Docker and continue') : vocab('Try deployment again')}
            </Button>
          </>
        )}

        <div className="phone-pair__divider" />
        <div className="phone-pair__hint">{vocab('No Pro plan, paid seat, subscription, or purchase is required.')}</div>
        <Button variant="outlined" size="small" vocabularyMode="factual" className="phone-pair__link phone-pair__footer" onClick={onOpenSettings}>
          {vocab('All device settings…')}
        </Button>
      </div>
    </>,
    document.body
  )
}
