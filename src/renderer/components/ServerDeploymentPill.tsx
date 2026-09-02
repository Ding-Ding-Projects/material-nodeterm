import { useEffect, useState } from 'react'
import { Button } from '@renderer/ui/md3'

/** Bottom-left, always-visible while a Server Edition deployment is up: the address someone types
 *  into another device's browser, with a copy action. Shares the usage/system-resource pills'
 *  shell and positioning (`overBoard` raises it above the opaque kanban board exactly like they
 *  do) so it reads as one more member of that cluster rather than a new floating widget.
 *
 *  Deliberately absent when nothing is deployed — an always-present "not running" pill would be a
 *  permanent light nobody asked for on every canvas that never touches Server Edition. Presence
 *  IS the signal.
 *
 *  Polls `serverDeployment.status()` (cheap: in-memory on the main side, no Docker round trip) so
 *  the pill also lights up for a deployment started from a different window's phone-pair popover,
 *  and clears itself if this app process's own record of it is gone (e.g. after a relaunch, where
 *  the in-memory cache does not survive — see `status()`'s doc comment in shared/types.ts). */
export function ServerDeploymentPill({ overBoard = false }: { overBoard?: boolean }): JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      void window.nodeTerminal.serverDeployment
        .status()
        .then((s) => {
          if (!cancelled) setUrl(s.running && s.url ? s.url : null)
        })
        .catch(() => {
          if (!cancelled) setUrl(null)
        })
    }
    refresh()
    const timer = window.setInterval(refresh, 5_000)
    // A stage reaching 'ready' means a deployment just finished on THIS or another window; refresh
    // immediately rather than waiting up to 5s for the poll to notice.
    const unsub = window.nodeTerminal.serverDeployment.onProgress((stage) => {
      if (stage === 'ready') refresh()
    })
    return () => {
      cancelled = true
      window.clearInterval(timer)
      unsub()
    }
  }, [])

  if (!url) return null

  const copy = async (): Promise<void> => {
    const ok = await window.nodeTerminal.clipboard.writeText(url)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_500)
    }
  }

  return (
    <div className={`server-deploy-indicator${overBoard ? ' server-deploy-indicator--board' : ''}`}>
      <Button variant="outlined" size="small" vocabularyMode="factual"
        type="button"
        className="server-deploy-pill"
        onClick={() => void copy()}
        title={`Server Edition is reachable at ${url} — click to copy`}
      >
        <span className="server-deploy-pill__dot" aria-hidden="true" />
        <span className="server-deploy-pill__detail">{url}</span>
        <span className="server-deploy-pill__copy" aria-hidden="true">{copied ? '✓' : '⧉'}</span>
        <span className="sr-only">{copied ? 'Copied' : `Copy ${url} to clipboard`}</span>
      </Button>
    </div>
  )
}
