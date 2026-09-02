import { useEffect, useMemo, useRef, useState } from 'react'
import {
  NODE_CATALOG,
  NODE_CATALOG_CATEGORIES,
  nodeCatalogAvailability,
  searchNodeCatalog,
  newCreationEventId,
  type NodeCatalogAvailabilityContext,
  type NodeCatalogCategory,
  type NodeCatalogEntry
} from '@shared/node-catalog'
import { Dialog } from '../ui/md3/Dialog'
import { Chip } from '../ui/md3/Chip'
import { ChipRow } from '../ui/md3/ChipRow'
import { TextField } from '../ui/md3/TextField'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from './regex/AnchoredRegexBuilder'
import { useI18n } from '../lib/i18n'
import { writeAuthenticatorDrag } from '../lib/explorerNodeDrag'
import { useLocalizedVocabularyText } from '../lib/personalVocabulary/useLocalizedVocabularyText'
import { usePersonalVocabulary } from '../state/personalVocabulary'
import { useSchoolMode } from '../state/schoolMode'
import { applyVocabulary } from '../lib/personalVocabulary/apply'
import type { TerminalProfileChoice } from '../lib/terminal-profile-actions'
import type { NamedTerminalProfile } from '@shared/types'
import { Button } from '@renderer/ui/md3'
import { ListRow } from '../ui/md3/ListRow'

export interface NodeCatalogDialogProps {
  open: boolean
  onClose: () => void
  context: NodeCatalogAvailabilityContext
  terminalProfileChoices?: readonly TerminalProfileChoice[]
  namedTerminalProfiles?: readonly NamedTerminalProfile[]
  /** Called with one stable event id so retries cannot mint duplicate nodes. */
  onCreate: (
    entry: NodeCatalogEntry,
    creationEventId: string,
    options?: { terminalProfileId?: string; namedTerminalProfileId?: string }
  ) => void
  /** Opens the article in the bundled in-app documentation browser. */
  onOpenDocumentation: (path: string) => void
}

const CATEGORY_LABELS: Record<NodeCatalogCategory, { id: string; fallback: string }> = {
  terminals: { id: 'nodeCatalog.category.terminals', fallback: 'Terminals' },
  agents: { id: 'nodeCatalog.category.agents', fallback: 'Agents' },
  canvas: { id: 'nodeCatalog.category.canvas', fallback: 'Canvas' },
  files: { id: 'nodeCatalog.category.files', fallback: 'Files' },
  media: { id: 'nodeCatalog.category.media', fallback: 'Media' },
  managers: { id: 'nodeCatalog.category.managers', fallback: 'Managers' },
  automation: { id: 'nodeCatalog.category.automation', fallback: 'Automation' },
  tools: { id: 'nodeCatalog.category.tools', fallback: 'Tools' },
  universes: { id: 'nodeCatalog.category.universes', fallback: 'Universes' },
  hosting: { id: 'nodeCatalog.category.hosting', fallback: 'Hosting' }
}

function entryText(entry: NodeCatalogEntry, kind: 'label' | 'description'): { id: string; fallback: string } {
  return {
    id: `nodeCatalog.entry.${entry.id.replace(':', '.')}.${kind}`,
    fallback: kind === 'label' ? entry.label : entry.description
  }
}

/** Guided registry picker shared by the FAB, pane context menu and command palette. */
/** Profile chips shown before the row folds behind "+N more" — two rows of 32px chips in the
 *  dialog's width; the selected default and the first machine profiles stay visible. */
const PROFILE_CHIPS_SHOWN = 8

export function NodeCatalogDialog({ open, onClose, context, terminalProfileChoices = [], namedTerminalProfiles = [], onCreate, onOpenDocumentation }: NodeCatalogDialogProps) {
  const { t, emoji } = useI18n()
  const profileText = useLocalizedVocabularyText()
  const docsLabel = profileText('nodeCatalog.docs', 'Documentation')
  const vocabularyEntries = usePersonalVocabulary((state) => state.entries)
  const schoolModeEnabled = useSchoolMode((state) => state.enabled)
  const localize = (value: string): string =>
    schoolModeEnabled ? value : applyVocabulary(value, vocabularyEntries)
  const blockText = (id: string, fallback: string) => {
    const value = t(id, fallback)
    return { primary: localize(value.primary), secondary: value.secondary ? localize(value.secondary) : null }
  }
  const field = useRegexSearchField()
  const inputRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<NodeCatalogCategory | 'all'>('all')
  const [active, setActive] = useState(0)
  const [terminalProfileId, setTerminalProfileId] = useState<string | undefined>(undefined)
  const [namedTerminalProfileId, setNamedTerminalProfileId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (open) {
      setActive(0)
      setCategory('all')
      setTerminalProfileId(undefined)
      setNamedTerminalProfileId(undefined)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const visible = useMemo(() => {
    const permittedEntries = schoolModeEnabled ? NODE_CATALOG.filter((entry) => entry.id !== 'wild-dim-sum') : NODE_CATALOG
    const categoryEntries =
      category === 'all' ? permittedEntries : permittedEntries.filter((entry) => entry.category === category)
    return searchNodeCatalog(
      categoryEntries,
      field.query,
      field.mode === 'regex' && field.query.length > 0 ? field.test : undefined
    )
  }, [category, field.mode, field.query, field.pattern, field.flags, field.test, schoolModeEnabled])

  const availability = (entry: NodeCatalogEntry) => nodeCatalogAvailability(entry, context)
  const create = (entry: NodeCatalogEntry) => {
    const state = availability(entry)
    if (!state.available) return
    onCreate(
      entry,
      newCreationEventId(),
      entry.category === 'terminals' || entry.category === 'agents'
        ? {
            ...(terminalProfileId ? { terminalProfileId } : {}),
            ...(namedTerminalProfileId ? { namedTerminalProfileId } : {})
          }
        : undefined
    )
    onClose()
  }

  const moveActive = (delta: number) => {
    if (!visible.length) return
    setActive((value) => (value + delta + visible.length) % visible.length)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={profileText('nodeCatalog.title', 'Node Catalog')}
      icon={<div className="node-catalog-dialog__icon" aria-hidden="true">{emoji('🧭')}</div>}
      className="node-catalog-dialog"
    >
      <p className="node-catalog-dialog__intro">
        {(() => { const value = blockText('nodeCatalog.description', 'Choose a node from the typed catalog. Safe defaults are applied now; machine-local details stay local.'); return <><span>{value.primary}</span>{value.secondary && <span className="node-catalog-dialog__secondary">{value.secondary}</span>}</> })()}
      </p>
      <div className="node-catalog-dialog__search">
        <TextField
          ref={inputRef}
          label={profileText('nodeCatalog.search.label', 'Search node catalog')}
          value={field.value}
          spellCheck={false}
          aria-controls="node-catalog-results"
          aria-activedescendant={visible[active] ? `node-catalog-entry-${visible[active].id}` : undefined}
          onChange={(event) => {
            field.setValue(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              moveActive(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              moveActive(-1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const entry = visible[active]
              if (entry) create(entry)
            } else if (event.key === 'Escape') {
              if (field.query) {
                event.preventDefault()
                field.setValue('')
              } else onClose()
            }
          }}
          trailingSlot={<AnchoredRegexBuilder search={field} fieldRef={inputRef} label="Regex: node catalog search" />}
          supportText={field.error ?? profileText('nodeCatalog.results.count', `${visible.length} node${visible.length === 1 ? '' : 's'} shown`, { count: String(visible.length) })}
          invalid={!!field.error}
        />
      </div>

      <ChipRow className="node-catalog-dialog__categories" role="toolbar" aria-label={profileText('nodeCatalog.categories', 'Node categories')}>
        <Chip selected={category === 'all'} onClick={() => { setCategory('all'); setActive(0) }}>
          {profileText('nodeCatalog.category.all', 'All')}
        </Chip>
        {NODE_CATALOG_CATEGORIES.map((item) => {
          const label = CATEGORY_LABELS[item]
          return (
            <Chip key={item} selected={category === item} onClick={() => { setCategory(item); setActive(0) }}>
              {profileText(label.id, label.fallback)}
            </Chip>
          )
        })}
      </ChipRow>

      {(terminalProfileChoices.length > 0 || namedTerminalProfiles.length > 0) && (
        <ChipRow
          className="node-catalog-dialog__profiles"
          role="group"
          aria-label={profileText('nodeCatalog.profile.label', 'Terminal profile')}
          label={profileText('nodeCatalog.profile.label', 'Terminal profile')}
          collapseAfter={PROFILE_CHIPS_SHOWN}
        >
          <Chip selected={!terminalProfileId && !namedTerminalProfileId} onClick={() => { setTerminalProfileId(undefined); setNamedTerminalProfileId(undefined) }}>
            {profileText('nodeCatalog.profile.auto', 'Use saved default')}
          </Chip>
          {terminalProfileChoices.map((profile) => (
            <Chip
              key={profile.id}
              vocabularyMode="factual"
              disabled={profile.disabled}
              selected={terminalProfileId === profile.id && !namedTerminalProfileId}
              title={profile.hint}
              onClick={() => { setTerminalProfileId(profile.id); setNamedTerminalProfileId(undefined) }}
            >
              {profile.label}
            </Chip>
          ))}
          {namedTerminalProfiles.map((profile) => (
            <Chip
              key={profile.id}
              vocabularyMode="factual"
              selected={namedTerminalProfileId === profile.id}
              title={`${profile.cwd}${profile.startupCommand ? ` · ${profile.startupCommand}` : ''}`}
              onClick={() => { setNamedTerminalProfileId(profile.id); setTerminalProfileId(undefined) }}
            >
              {profile.name}
            </Chip>
          ))}
        </ChipRow>
      )}

      <div id="node-catalog-results" className="node-catalog-dialog__list" role="listbox" aria-label={profileText('nodeCatalog.results', 'Node catalog results')}>
        {!visible.length ? (
          <div className="node-catalog-dialog__empty" role="status">
            {profileText('nodeCatalog.empty', 'No nodes match this search. Try plain text or open the regex builder for a pattern.')}
          </div>
        ) : (
          visible.map((entry, index) => {
            const state = availability(entry)
            const label = entryText(entry, 'label')
            const description = entryText(entry, 'description')
            const disabled = !state.available
            const labelValue = blockText(label.id, label.fallback)
            const descriptionValue = blockText(description.id, description.fallback)
            return (
              <div
                key={entry.id}
                id={`node-catalog-entry-${entry.id}`}
                className={`node-catalog-dialog__row${index === active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}
                role="option"
                aria-selected={index === active}
                aria-disabled={disabled}
                onMouseEnter={() => setActive(index)}
              >
                {/* A catalog row is a Material LIST ITEM, not a pill button: it stacks a title, an
                    availability line, a bilingual description and a disabled reason. `mdx-btn--small`
                    is a hard `height: 32px` with `line-height: 1` and `white-space: nowrap`, so four
                    stacked lines overflowed it and collided with the neighbouring rows. `ListRow` is
                    the design system's list item and grows with its content; the catalog only relaxes
                    its one-line `__sub` clamp (see styles.md3.css). */}
                <ListRow
                  className="node-catalog-dialog__row-main"
                  vocabularyMode="factual"
                  disabled={disabled}
                  draggable={!disabled && entry.id === 'authenticator'}
                  onDragStart={(event) => {
                    if (entry.id === 'authenticator' && event.dataTransfer) {
                      writeAuthenticatorDrag(event.dataTransfer)
                    }
                  }}
                  onClick={() => create(entry)}
                  title={localize(state.reason ?? '')}
                  label={<span className="node-catalog-dialog__row-title"><span>{labelValue.primary}</span>{labelValue.secondary && <span className="node-catalog-dialog__row-secondary">{labelValue.secondary}</span>}</span>}
                  sub={
                    <>
                      <span className="node-catalog-dialog__row-mode">{profileText(
                        entry.availabilityMode === 'configure-later' ? 'nodeCatalog.mode.configureLater' : 'nodeCatalog.mode.required',
                        entry.availabilityMode === 'configure-later' ? 'Configure later' : 'Ready when required capabilities are available'
                      )}</span>
                      <span className="node-catalog-dialog__row-description"><span>{descriptionValue.primary}</span>{descriptionValue.secondary && <span className="node-catalog-dialog__row-secondary">{descriptionValue.secondary}</span>}</span>
                      {disabled && <span className="node-catalog-dialog__row-reason">{localize(state.reason ?? '')}</span>}
                    </>
                  }
                />
                <Button variant="outlined" size="small" vocabularyMode="factual" className="node-catalog-dialog__docs" type="button" onClick={() => onOpenDocumentation(entry.documentationPath)} aria-label={`${profileText(label.id, label.fallback)} ${docsLabel}`}>
                  {docsLabel}
                </Button>
              </div>
            )
          })
        )}
      </div>
      <div className="node-catalog-dialog__hint" role="note">
        {profileText('nodeCatalog.keyboardHint', 'Use Up and Down to choose, Enter to create, and Escape to clear or close. Disabled rows explain what to do next.')}
      </div>
    </Dialog>
  )
}
