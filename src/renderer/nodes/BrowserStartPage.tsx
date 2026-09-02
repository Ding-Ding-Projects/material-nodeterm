import { useRef } from 'react'
import { searchOrUrl } from './browserUrl'
import { SHORTCUTS, SiteIcon } from './browserIcons'
import { useBrowserHistory } from '../state/browserHistory'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'
import { mapAroundExactFacts } from './nodeVocabulary'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'
import { SearchField, ListRow } from '@renderer/ui/md3'
import { Button } from '@renderer/ui/md3'

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
        <SearchField
          ref={searchRef}
          className="startpage__searchbar"
          inputClassName="startpage__search"
          vocabularyMode="factual"
          spellCheck={false}
            value={search.value}
            placeholder={mapAroundExactFacts('Search Google or type a URL', ['Google'], vocab)}
            aria-label={vocab('Search Google or type a URL')}
            onChange={(e) => search.setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          trailingSlot={<AnchoredRegexBuilder search={search} fieldRef={searchRef} label={vocab('Regex — browser start page')} />}
        />

        <div className="startpage__grid">
          {visibleShortcuts.map((s) => (
            <Button
              key={s.url}
              variant="text"
              vocabularyMode="factual"
              className="startpage__tile"
              title={s.label}
              onClick={() => onNavigate(s.url)}
            >
              <SiteIcon url={s.url} label={s.label} />
              <span className="startpage__tile-label">{s.label}</span>
            </Button>
          ))}
        </div>

        {visibleRecent.length > 0 && (
          <div className="startpage__recent">
            <div className="startpage__recent-title">{vocab('Recent')}</div>
            {visibleRecent.map((e) => (
              <ListRow
                key={`${e.url}-${e.ts}`}
                className="startpage__recent-item"
                vocabularyMode="factual"
                icon={<SiteIcon url={e.url} size={22} />}
                label={<span className="startpage__recent-name">{e.title}</span>}
                sub={<span className="startpage__recent-host">{hostLabel(e.url)}</span>}
                onClick={() => onNavigate(e.url)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
