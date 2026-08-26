// One release's card in the changelog viewer: version pill, date, commit link chip(s), and every
// bullet grouped by its category. See ChangelogPanel.tsx for the filtering/search shell around it.

import type { ChangelogRelease } from '@shared/changelog'
import { renderMarkdown } from '../../lib/markdown'
import { Checkbox } from '@renderer/ui/md3'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

/**
 * A small, deterministic color class per category — cycled by NAME (a stable hash), not by
 * position in a hard-coded list. Adding a new `### ` heading to CHANGELOG.md must never require
 * touching this file for it to render with SOME distinguishable tone.
 */
const CATEGORY_TONES = ['a', 'b', 'c', 'd', 'e', 'f'] as const
function categoryTone(category: string): string {
  let hash = 0
  for (let i = 0; i < category.length; i += 1) hash = (hash * 31 + category.charCodeAt(i)) >>> 0
  return CATEGORY_TONES[hash % CATEGORY_TONES.length]
}

function formatReleaseDate(dateMs: number | null): string | null {
  if (dateMs === null) return null
  return new Date(dateMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export interface ReleaseCardProps {
  release: ChangelogRelease
  /** True while a text/regex query is active — used only to decide whether to show the "N of M
   *  items match" note; it never hides individual bullets (see ChangelogPanel's header comment on
   *  why filtering stays release-level). */
  selected: boolean
  onToggleSelect: (shiftKey: boolean) => void
}

export function ReleaseCard({ release, selected, onToggleSelect }: ReleaseCardProps): JSX.Element {
  const vocab = useVocabularyMapper()
  const dateLabel = formatReleaseDate(release.dateMs)
  const isUnreleased = release.version === 'Unreleased'

  return (
    <li className="md3-changelog-release">
      <div className="md3-changelog-release__head">
        <Checkbox
          className="md3-changelog-release__select"
          aria-label={`${vocab('Select release')} ${release.version}`}
          checked={selected}
          onClick={(e) => {
            e.preventDefault()
            onToggleSelect(e.shiftKey)
          }}
          onChange={() => {}}
        />
        <span className={`md3-changelog-version${isUnreleased ? ' md3-changelog-version--unreleased' : ''}`}>
          {isUnreleased ? vocab('Unreleased') : `v${release.version}`}
        </span>
        {dateLabel && <span className="md3-changelog-date">{dateLabel}</span>}
        <div className="md3-changelog-commits">
          {release.commits.map((c) => (
            <button
              key={c.sha}
              type="button"
              className="md3-changelog-commit"
              title={vocab('Open commit on GitHub')}
              onClick={() => window.nodeTerminal.shell.openExternal(c.url)}
            >
              {c.label.slice(0, 8)}
            </button>
          ))}
          {release.commits.length === 0 && (
            <span className="md3-changelog-commit md3-changelog-commit--none" title={vocab('No commit link recorded for this release')}>
              —
            </span>
          )}
        </div>
      </div>

      {release.items.length === 0 ? (
        <div className="md3-changelog-empty">{vocab('No changes recorded for this release.')}</div>
      ) : (
        <ul className="md3-changelog-items">
          {release.items.map((item, i) => (
            // Category + text is not a stable identity on its own (two identical bullets under the
            // same heading are legitimately different releases' worth of "v0.2.x" chores), but a
            // release's item order never reshuffles, so the index is a safe list key here.
            // eslint-disable-next-line react/no-array-index-key
            <li key={i} className="md3-changelog-item">
              <span className={`md3-changelog-cat md3-changelog-cat--${categoryTone(item.category)}`}>
                {item.category}
              </span>
              {/* Release notes are a FACT generated from git history and rendered as the markup
                  they actually are (bold, code spans, links) — never printed with literal asterisks,
                  and never funnified or translated (CLAUDE.md: "release bullet text is a FACT"). */}
              <span
                className="md3-changelog-item__text"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
