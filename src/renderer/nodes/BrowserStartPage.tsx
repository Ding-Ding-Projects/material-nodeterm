import { useRef } from 'react'
import { searchOrUrl } from './browserUrl'
import { SHORTCUTS, SiteIcon } from './browserIcons'
import { useBrowserHistory } from '../state/browserHistory'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { mapAroundExactFacts } from './nodeVocabulary'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** The Chrome-like new-tab page shown inside a blank browser node. */
export function BrowserStartPage({ onNavigate }: { onNavigate: (url: string) => void }): JSX.Element {
  const vocab = useVocabularyMapper()
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const recent = useBrowserHistory((s) => s.recent(8))
  const submit = (): void => {
    const u = searchOrUrl(search.value)
    if (u) onNavigate(u)
  }
  const visibleShortcuts = SHORTCUTS.filter((shortcut) => search.test(`${shortcut.label} ${shortcut.url}`))
  const visibleRecent = recent.filter((entry) => search.test(`${entry.title} ${entry.url}`))
  return (
    <div className="startpage nodrag nowheel">
      <div className="startpage__inner">
        <div className="startpage__searchbar">
          <span className="startpage__search-icon">⌕</span>
          <input
            ref={searchRef}
            className="startpage__search"
            spellCheck={false}
            value={search.value}
            placeholder={mapAroundExactFacts('Search Google or type a URL', ['Google'], vocab)}
            aria-label={vocab('Search Google or type a URL')}
            onChange={(e) => search.setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
          <AnchoredRegexBuilder search={search} fieldRef={searchRef} label={vocab('Regex — browser start page')} />
        </div>

        <div className="startpage__grid">
          {visibleShortcuts.map((s) => (
            <button
              key={s.url}
              className="startpage__tile"
              title={s.label}
              onClick={() => onNavigate(s.url)}
            >
              <SiteIcon url={s.url} label={s.label} />
              <span className="startpage__tile-label">{s.label}</span>
            </button>
          ))}
        </div>

        {visibleRecent.length > 0 && (
          <div className="startpage__recent">
            <div className="startpage__recent-title">{vocab('Recent')}</div>
            {visibleRecent.map((e) => (
              <button
                key={`${e.url}-${e.ts}`}
                className="startpage__recent-item"
                onClick={() => onNavigate(e.url)}
              >
                <SiteIcon url={e.url} size={22} />
                <span className="startpage__recent-name">{e.title}</span>
                <span className="startpage__recent-host">{hostLabel(e.url)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
