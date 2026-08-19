import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

type DeploymentState = 'starting' | 'ready' | 'docker-restart-required' | 'failed'

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
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  const start = async (): Promise<void> => {
    setState('starting')
    setError('')
    const result = await window.nodeTerminal.serverDeployment.start()
    if (result.ok && result.url) {
      setUrl(result.url)
      setState('ready')
    } else {
      setError(result.error ?? 'Server Edition could not be started.')
      setState(result.state === 'docker-restart-required' ? 'docker-restart-required' : 'failed')
    }
  }

  useEffect(() => { void start() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <>
      <div className="phone-pair__backdrop" onClick={onClose} />
      <div
        className="phone-pair"
        style={{ top: anchor.bottom + 8, right: Math.max(8, window.innerWidth - anchor.right) }}
        role="dialog"
        aria-label="Server Edition deployment"
      >
        <div className="phone-pair__title">Open nodeterm on another device</div>

        {state === 'starting' ? (
          <>
            <div className="phone-pair__hint">Starting Server Edition…</div>
            <div className="phone-pair__hint">Docker Desktop and the local server image are obtained automatically when missing. The first build can take several minutes.</div>
          </>
        ) : state === 'ready' ? (
          <>
            <div className="phone-pair__ok">✓ Server Edition is healthy and ready.</div>
            <div className="phone-pair__hint">Use the site from this PC now. Mobile access will appear here only after its protected TOTP transport is configured.</div>
            <button className="phone-pair__btn" onClick={() => void window.nodeTerminal.shell.openExternal(url)}>
              Open Server Edition
            </button>
            <div className="phone-pair__hint">{url}</div>
          </>
        ) : (
          <>
            <div className="phone-pair__warn">{error}</div>
            <button className="phone-pair__btn" onClick={() => void start()}>
              {state === 'docker-restart-required' ? 'Check Docker and continue' : 'Try deployment again'}
            </button>
          </>
        )}

        <div className="phone-pair__divider" />
        <div className="phone-pair__hint">No Pro plan, paid seat, subscription, or purchase is required.</div>
        <button className="phone-pair__link phone-pair__footer" onClick={onOpenSettings}>
          All device settings…
        </button>
      </div>
    </>,
    document.body
  )
}
