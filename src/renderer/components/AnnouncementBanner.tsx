import { useEffect, useState } from 'react'
import type { Announcement } from '@shared/types'
import { useI18n } from '@renderer/lib/i18n'

// Polls the remote announcements feed (via the main process) and shows the newest
// item the user hasn't dismissed. Dismissed ids are remembered in localStorage so a
// given announcement is shown only once. Separate from the update banner.
const SEEN_KEY = 'nodeterm.seenAnnouncements'
const SIX_HOURS = 6 * 60 * 60 * 1000

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveSeen(seen: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]))
  } catch {
    // ignore quota / serialization errors
  }
}

export function AnnouncementBanner(): JSX.Element | null {
  const [current, setCurrent] = useState<Announcement | null>(null)
  const { ts } = useI18n()

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      const items = await window.nodeTerminal.announcements.fetch()
      if (cancelled || !items.length) return
      const seen = loadSeen()
      // Feed is newest-first; show the first one not yet dismissed.
      const next = items.find((a) => !seen.has(a.id))
      if (next) setCurrent(next)
    }

    void check()
    const timer = setInterval(check, SIX_HOURS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (!current) return null

  const dismiss = () => {
    const seen = loadSeen()
    seen.add(current.id)
    saveSeen(seen)
    setCurrent(null)
  }

  return (
    <div className={`announce-banner announce-banner--${current.level ?? 'info'}`}>
      <span className="announce-banner__dot" />
      <div className="announce-banner__content">
        <span className="announce-banner__title">{current.title}</span>
        {current.body && <span className="announce-banner__body">{current.body}</span>}
      </div>
      {current.url && (
        <button
          className="announce-banner__btn"
          onClick={() => window.open(current.url, '_blank', 'noopener')}
        >
          {ts('announce.learnMore', 'Learn more')}
        </button>
      )}
      <button
        className="announce-banner__close"
        title={ts('announce.dismiss', 'Dismiss')}
        onClick={dismiss}
      >
        ✕
      </button>
    </div>
  )
}
