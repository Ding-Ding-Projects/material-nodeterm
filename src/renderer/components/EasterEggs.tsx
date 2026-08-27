import { useEffect, useMemo, useRef, useState } from 'react'
import { EASTER_EGG_CATALOG, eggCopy, type EasterEggEntry } from '@shared/easter-eggs'
import { useI18n } from '../lib/i18n'
import { useSchoolMode } from '../state/schoolMode'
import { schoolModeAllowsOptionalFeatures } from '../lib/schoolModePolicy'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

const STORAGE_KEY = 'nodeterm.easter-eggs.v1'
const ARM_MS = 3000

const LABELS = {
  en: {
    cabinet: 'Easter egg cabinet',
    description: 'Local, harmless interface surprises. They never change project data or run commands.',
    arm: 'Press Ctrl+Alt+Shift+E, then type an egg code. Alt-click a marked surface for its next local surprise.',
    reset: 'Reset discoveries',
    close: 'Close cabinet',
    try: 'Try this egg',
    found: 'Discovered',
    hidden: 'Not discovered',
    armed: 'Egg code armed for three seconds.',
    school: 'This cabinet is unavailable in the selected mode.'
  },
  yue: {
    cabinet: '彩蛋櫃',
    description: '本機無害介面小驚喜，唔會改專案資料或者執行指令。',
    arm: '按 Ctrl+Alt+Shift+E，再輸入彩蛋代碼。喺有標記嘅畫面按住 Alt 撳，會有下一個本機小驚喜。',
    reset: '重設探索記錄',
    close: '關閉彩蛋櫃',
    try: '試吓呢隻彩蛋',
    found: '已發現',
    hidden: '未發現',
    armed: '彩蛋代碼已準備，限時三秒。',
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
  // The product's language sliders currently expose five values. Map those values onto the
  // catalog's ten explicit voice levels so every catalog row remains defined from 1 through 10.
  const slider = Math.max(1, Math.min(5, Math.round(value)))
  return slider === 5 ? 10 : slider * 2 - 1
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
  const [armed, setArmed] = useState(false)
  const [query, setQuery] = useState('')
  const [discovered, setDiscovered] = useState<Set<string>>(() => readDiscoveries())
  const [active, setActive] = useState<EasterEggEntry | null>(null)
  const timer = useRef<number | null>(null)
  const sequenceBuffer = useRef('')

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
      setArmed(false)
      setActive(null)
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.altKey && event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        setOpen(true)
        setArmed(false)
        sequenceBuffer.current = ''
        return
      }
      if (!armed) return
      const key = event.key.length === 1 ? event.key.toUpperCase() : ''
      if (!key) return
      sequenceBuffer.current += key
      const entry = EASTER_EGG_CATALOG.find((candidate) => candidate.trigger.kind === 'keyboard' && candidate.trigger.sequence === sequenceBuffer.current)
      if (entry) {
        event.preventDefault()
        setArmed(false)
        sequenceBuffer.current = ''
        announce(entry)
      } else if (!EASTER_EGG_CATALOG.some((candidate) => candidate.trigger.kind === 'keyboard' && candidate.trigger.sequence.startsWith(sequenceBuffer.current))) {
        sequenceBuffer.current = ''
      }
    }
    const onSurfaceClick = (event: MouseEvent): void => {
      if (!event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const surface = target.closest<HTMLElement>('[data-easter-surface]')?.dataset.easterSurface
      if (!surface) return
      const entry = EASTER_EGG_CATALOG.find((candidate) => candidate.surface === surface && !discovered.has(candidate.id))
      if (entry) announce(entry)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('click', onSurfaceClick)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('click', onSurfaceClick)
    }
  }, [allowed, armed, discovered])

  useEffect(() => {
    if (!armed) return
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setArmed(false), ARM_MS)
    return () => {
      if (timer.current != null) window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [armed])

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return EASTER_EGG_CATALOG
    return EASTER_EGG_CATALOG.filter((entry) => `${entry.title} ${entry.surface} ${entry.id}`.toLocaleLowerCase().includes(needle))
  }, [query])

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
      {armed && (
        <div className="easter-eggs__armed" role="status" aria-live="polite">
          {vocab(labels.armed)}
        </div>
      )}
      {active && (
        <div className="easter-eggs__toast" role="status" aria-live="polite">
          <strong>{vocab(active.title)}</strong>
          <span>{copyFor(active)}</span>
          <button type="button" onClick={() => setActive(null)} aria-label={vocab('Dismiss Easter egg')}>
            {vocab('Dismiss')}
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
                <p className="easter-eggs__hint">{vocab(labels.arm)}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={vocab(labels.close)}>×</button>
            </header>
            <label className="easter-eggs__search">
              <span>{vocab('Search Easter eggs')}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={vocab('Search by title, surface, or id')} />
            </label>
            <div className="easter-eggs__actions">
              <button type="button" onClick={() => setArmed(true)}>{vocab('Arm an egg code')}</button>
              <button type="button" onClick={() => { setDiscovered(new Set()); saveDiscoveries(new Set()) }}>{vocab(labels.reset)}</button>
            </div>
            <p className="easter-eggs__count" role="status">{discovered.size} {vocab(labels.found)} · {EASTER_EGG_CATALOG.length} {vocab('available')}</p>
            <ul className="easter-eggs__list" aria-label={vocab(labels.cabinet)}>
              {visible.map((entry) => (
                <li key={entry.id} className="easter-eggs__row">
                  <div>
                    <strong>{vocab(entry.title)}</strong>
                    <span>{surfaceLabel(entry.surface, mode === 'yue')} · <code>{entry.trigger.kind === 'keyboard' ? entry.trigger.sequence : entry.trigger.target}</code></span>
                    <small>{discovered.has(entry.id) ? vocab(labels.found) : vocab(labels.hidden)}</small>
                  </div>
                  <button type="button" onClick={() => announce(entry)}>{vocab(labels.try)}</button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  )
}
