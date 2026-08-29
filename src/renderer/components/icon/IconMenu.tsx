import { useMemo, useRef, useState } from 'react'
import { PROJECT_SYMBOL_IDS, type ProjectIcon } from '@shared/project-icon'
import { Dialog, Button, IconButton } from '@renderer/ui/md3'
import { Input } from '@renderer/ui/Input'
import { useRegexSearchField } from '@renderer/lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../regex/AnchoredRegexBuilder'
import { ProjectGlyph } from '../ProjectGlyph'

export interface IconMenuProps {
  open: boolean
  /** The target's current icon (undefined = using the colour monogram fallback). */
  value?: ProjectIcon
  /** The target's colour — tints the preview and the "no icon" fallback. */
  color?: string
  name: string
  /** Applied once, on commit (typing an emoji + Use, or picking a Material Symbol). */
  onPick: (icon: ProjectIcon | undefined) => void
  onClose: () => void
}

/**
 * The icon-choice surface for a project row: type an emoji, search and pick one of the curated
 * Material Symbols, or reset to the plain colour monogram. Built on this app's own Material
 * Design 3 primitives (`ui/md3` barrel, `ui/Input`) — a centered `Dialog`, never a hand-rolled
 * popover with raw `<button>`/`<input>` elements.
 *
 * The Material Symbol grid is searchable with the app's standard search contract: plain text by
 * default, an adjacent `AnchoredRegexBuilder` for an explicit regex opt-in — the same pattern
 * `SettingsSidebar` uses for its section search, wired through the same `useRegexSearchField`
 * hook so query/pattern/flags/mode can never drift between surfaces.
 *
 * Scope note: upstream's picker (`feat/project-icon-picker-orca-design`) also has a GitHub-avatar
 * tab and a file-upload tab. Neither is ported — see `@shared/project-icon`'s header comment — so
 * this surface only covers the two icon kinds this fork's model supports: emoji and a curated
 * Material Symbol name.
 */
export function IconMenu({ open, value, color, name, onPick, onClose }: IconMenuProps): React.JSX.Element {
  const [emoji, setEmoji] = useState(value?.type === 'emoji' ? value.emoji : '')
  const search = useRegexSearchField({ mode: 'text' })
  const searchInputRef = useRef<HTMLInputElement>(null)

  const filteredSymbols = useMemo(
    () => PROJECT_SYMBOL_IDS.filter((id) => search.test(id.replace(/_/g, ' '))),
    [search]
  )

  const commitEmoji = (): void => {
    const trimmed = emoji.trim()
    if (trimmed.length > 0 && trimmed.length <= 16) onPick({ type: 'emoji', emoji: trimmed })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} title="Project icon" className="icon-menu">
      <div className="icon-menu__preview">
        <ProjectGlyph className="icon-menu__preview-glyph" icon={value} color={color} name={name} size={20} />
        <span className="icon-menu__preview-name">{name}</span>
      </div>

      <div className="icon-menu__section">
        <label className="icon-menu__label" htmlFor="icon-menu-emoji">
          Emoji
        </label>
        <div className="icon-menu__emoji-row">
          <Input
            id="icon-menu-emoji"
            type="text"
            value={emoji}
            maxLength={16}
            placeholder="🚀"
            autoFocus
            onChange={(e) => setEmoji(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEmoji()
            }}
          />
          <Button variant="tonal" onClick={commitEmoji} disabled={emoji.trim().length === 0}>
            Use
          </Button>
        </div>
      </div>

      <div className="icon-menu__section">
        <label className="icon-menu__label" htmlFor="icon-menu-search">
          Icon
        </label>
        <div className="menu-filter icon-menu__search">
          <div className="menu-filter__row">
            <Input
              id="icon-menu-search"
              ref={searchInputRef}
              className="icon-menu__search-input"
              value={search.value}
              spellCheck={false}
              placeholder={search.mode === 'regex' ? 'Filter icons… (regex)' : 'Filter icons…'}
              aria-label="Filter icons"
              onChange={(e) => search.setValue(e.target.value)}
            />
            <AnchoredRegexBuilder search={search} fieldRef={searchInputRef} label="Regex — icon picker" />
          </div>
          {search.error && <div className="menu-filter__error">{search.error}</div>}
        </div>
        <div className="icon-menu__symbol-grid" role="listbox" aria-label="Material Symbol icons">
          {filteredSymbols.length === 0 ? (
            <div className="icon-menu__empty">No icons match that filter.</div>
          ) : (
            filteredSymbols.map((id) => (
              <IconButton
                key={id}
                icon={id}
                aria-label={id.replace(/_/g, ' ')}
                title={id.replace(/_/g, ' ')}
                size="dense"
                active={value?.type === 'material-symbol' && value.name === id}
                onClick={() => {
                  onPick({ type: 'material-symbol', name: id })
                  onClose()
                }}
              />
            ))
          )}
        </div>
      </div>

      <Button
        variant="text"
        className="icon-menu__reset-btn"
        onClick={() => {
          onPick(undefined)
          onClose()
        }}
      >
        Reset to colour
      </Button>
    </Dialog>
  )
}
