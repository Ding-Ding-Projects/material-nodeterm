import { useEffect, useRef, useState } from 'react'
import { EASTER_EGG_CATALOG, eggCopy, type EasterEggEntry } from '@shared/easter-eggs'
import { useI18n } from '../lib/i18n'
import { useSchoolMode } from '../state/schoolMode'
import { schoolModeAllowsOptionalFeatures } from '../lib/schoolModePolicy'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { normalizeFunnyLevel } from '@shared/i18n'

const STORAGE_KEY = 'nodeterm.easter-eggs.v1'
const LABELS = {
  en: {
    cabinet: 'Easter egg cabinet',
    description: 'Local, harmless interface surprises. They never change project data or run commands.',
    reset: 'Reset discoveries',
    close: 'Close discovery history',
    found: 'Discovered',
    school: 'This cabinet is unavailable in the selected mode.'
  },
  yue: {
    cabinet: '彩蛋櫃',
    description: '本機無害介面小驚喜，唔會改專案資料或者執行指令。',
    reset: '重設探索記錄',
    close: '關閉探索記錄',
    found: '已發現',
    school: '目前模式不提供呢個彩蛋櫃。'
  }
} as const

function readDiscoveries(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string' && EASTER_EGG_CATALOG.some((e) => e.id === id)))
  } catch {
    return new Set()
  }
}

function saveDiscoveries(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].sort()))
  } catch {
    // A private storage refusal never blocks the cabinet or changes the current discovery.
  }
}

function levelFor(value: number): number {
  // Easter-egg copy has ten explicit voice levels too. Preserve the selected level rather than
  // collapsing 6–10 back onto the old five-level scale.
  return normalizeFunnyLevel(value, 1)
}

function surfaceLabel(surface: EasterEggEntry['surface'], yue: boolean): string {
  const labels: Record<EasterEggEntry['surface'], [string, string]> = {
    canvas: ['Canvas', '畫布'], nodes: ['Nodes', '節點'], 'title-bar': ['Title bar', '標題列'],
    settings: ['Settings', '設定'], 'command-palette': ['Command palette', '命令面板'], notifications: ['Notifications', '通知'],
    documentation: ['Documentation', '文件'], changelog: ['Changelog', '變更記錄'], search: ['Search', '搜尋'],
    'project-switcher': ['Project switcher', '專案切換器'], 'source-control': ['Source control', '版本控制'], media: ['Media', '媒體'],
    schedules: ['Schedules', '排程'], hosting: ['Hosting', '託管'], account: ['Account', '帳戶'], converter: ['Converter', '轉換器'],
    ollama: ['Local model manager', '本機模型管理器'], authenticator: ['Authenticator', '驗證器'], support: ['Support', '支援'], status: ['Status', '狀態']
  }
  return labels[surface][yue ? 1 : 0]
}

export function EasterEggs(): React.JSX.Element | null {
  const { mode, funnyLevelEn, funnyLevelYue } = useI18n()
  const schoolHydrated = useSchoolMode((s) => s.hydrated)
  const schoolEnabled = useSchoolMode((s) => s.enabled)
  const vocab = useVocabularyMapper()
  const allowed = schoolModeAllowsOptionalFeatures({ hydrated: schoolHydrated, enabled: schoolEnabled })
  const [open, setOpen] = useState(false)
  const [discovered, setDiscovered] = useState<Set<string>>(() => readDiscoveries())
  const [active, setActive] = useState<EasterEggEntry | null>(null)
  const interactions = useRef<Record<string, number>>({})
  const lastDiscoveryAt = useRef(0)

  const announce = (entry: EasterEggEntry): void => {
    setDiscovered((current) => {
      const next = new Set(current)
      next.add(entry.id)
      saveDiscoveries(next)
      return next
    })
    setActive(entry)
    setOpen(false)
  }

  useEffect(() => {
    if (!allowed) {
      setOpen(false)
      setActive(null)
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onSurfaceClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const surface = target.closest<HTMLElement>('[data-easter-surface]')?.dataset.easterSurface
      if (!surface) return
      const count = (interactions.current[surface] ?? 0) + 1
      interactions.current[surface] = count
      if (count % 3 !== 0 || Date.now() - lastDiscoveryAt.current < 45_000) return
      const entry = EASTER_EGG_CATALOG.find((candidate) => candidate.surface === surface && !discovered.has(candidate.id))
      if (entry && entry.trigger.kind === 'contextual' && count >= entry.trigger.minimumInteractions) {
        lastDiscoveryAt.current = Date.now()
        announce(entry)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('click', onSurfaceClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('click', onSurfaceClick)
    }
  }, [allowed, discovered])

  if (!allowed) return null

  const language = mode === 'yue' ? 'yue' : 'en'
  const labels = LABELS[language]
  const copyFor = (entry: EasterEggEntry): string => {
    const en = vocab(eggCopy(entry, 'en', levelFor(funnyLevelEn)))
    const yue = vocab(eggCopy(entry, 'yue', levelFor(funnyLevelYue)))
    return mode === 'bilingual' ? `${en} · ${yue}` : mode === 'yue' ? yue : en
  }

  return (
    <>
      {active && (
        <div className="easter-eggs__toast" role="status" aria-live="polite">
          <strong>{vocab(active.title)}</strong>
          <span>{copyFor(active)}</span>
          <button type="button" onClick={() => setActive(null)} aria-label={vocab('Dismiss Easter egg')}>
            {vocab('Dismiss')}
          </button>
          <button type="button" onClick={() => { setOpen(true); setActive(null) }}>
            {vocab('View discovery history')}
          </button>
        </div>
      )}
      {open && (
        <div className="easter-eggs__backdrop" role="presentation" onClick={() => setOpen(false)}>
          <section className="easter-eggs__cabinet" role="dialog" aria-modal="false" aria-labelledby="easter-eggs-title" onClick={(event) => event.stopPropagation()}>
            <header className="easter-eggs__header">
              <div>
                <h2 id="easter-eggs-title">{vocab(labels.cabinet)}</h2>
                <p>{vocab(labels.description)}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={vocab(labels.close)}>×</button>
            </header>
            <div className="easter-eggs__actions">
              <button type="button" onClick={() => { setDiscovered(new Set()); saveDiscoveries(new Set()) }}>{vocab(labels.reset)}</button>
            </div>
            <p className="easter-eggs__count" role="status">{discovered.size} {vocab(labels.found)}</p>
            <ul className="easter-eggs__list" aria-label={vocab(labels.cabinet)}>
              {EASTER_EGG_CATALOG.filter((entry) => discovered.has(entry.id)).map((entry) => (
                <li key={entry.id} className="easter-eggs__row">
                  <div>
                    <strong>{vocab(entry.title)}</strong>
                    <span>{surfaceLabel(entry.surface, mode === 'yue')}</span>
                    <small>{vocab(labels.found)}</small>
                  </div>
                </li>
              ))}
            </ul>
            {discovered.size === 0 && <p className="easter-eggs__count">{vocab('No discoveries yet. Keep using the marked surfaces.')}</p>}
          </section>
        </div>
      )}
    </>
  )
}
