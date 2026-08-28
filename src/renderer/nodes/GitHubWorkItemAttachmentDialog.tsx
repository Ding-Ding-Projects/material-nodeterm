import { useMemo, useRef, useState } from 'react'
import type { GitHubWorkItem } from '@shared/github-work-items'
import { canAdoptPullRequestOnFrame } from '@shared/github-work-items'
import { Dialog } from '../ui/md3/Dialog'
import { TextField } from '../ui/md3/TextField'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'

export interface GitHubWorkItemAttachmentDialogProps {
  open: boolean
  targetNodeId: string
  frameId?: string
  frameBranch?: string
  items: readonly GitHubWorkItem[]
  onClose: () => void
  onAttach: (item: GitHubWorkItem) => void
}

/** Guided local review surface for attaching provider-backed work items to an existing node. */
export function GitHubWorkItemAttachmentDialog({
  open,
  targetNodeId,
  frameId,
  frameBranch,
  items,
  onClose,
  onAttach
}: GitHubWorkItemAttachmentDialogProps): React.JSX.Element | null {
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const filteredItems = useMemo(() => {
    const query = search.query.trim().toLocaleLowerCase()
    const source = items.slice(0, 500)
    if (!query) return source
    return source.filter((item) => {
      const text = `${item.repository} #${item.number} ${item.title}`
      return search.mode === 'regex' && !search.error ? search.test(text) : text.toLocaleLowerCase().includes(query)
    })
  }, [items, search.error, search.flags, search.mode, search.pattern, search.query, search.test])
  const selected = filteredItems.find((item) => `${item.repository}#${item.number}` === selectedKey) ?? null
  const adopt = !!selected && !!frameId && canAdoptPullRequestOnFrame(selected, frameBranch)

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Attach GitHub work item"
      className="github-work-item-attachment-dialog"
      actions={(
        <>
          <button type="button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              if (!selected) return
              onAttach({
                ...selected,
                attachedNodeId: targetNodeId,
                ...(frameId ? { owningGroupId: frameId } : {}),
                binding: adopt ? 'adopted' : 'explicit'
              })
              onClose()
            }}
          >
            {adopt ? 'Adopt on this frame' : 'Attach to this node'}
          </button>
        </>
      )}
    >
      <p className="github-work-item-attachment-dialog__hint">
        Choose an item from the provider-backed records already loaded for this project. The chip will
        appear on this session node. A frame pill appears only for this node's owning frame.
      </p>
      <TextField
        ref={searchRef}
        label="Search work items"
        value={search.value}
        onChange={(event) => {
          search.setValue(event.target.value)
          setSelectedKey(null)
        }}
        placeholder="Search by repository, number, or title"
        aria-controls="github-work-item-attachment-results"
        trailingSlot={<AnchoredRegexBuilder search={search} fieldRef={searchRef} label="Regex: work item search" />}
        supportText={search.error ?? `${filteredItems.length} provider-backed item${filteredItems.length === 1 ? '' : 's'} available`}
        invalid={!!search.error}
      />
      <div id="github-work-item-attachment-results" className="github-work-item-attachment-dialog__list" role="listbox" aria-label="Provider-backed GitHub work items">
        {filteredItems.length === 0 ? (
          <p className="github-work-item-attachment-dialog__empty" role="status">
            No provider-backed work items are available. Refresh the GitHub issue surface, then reopen this guide.
          </p>
        ) : filteredItems.map((item) => {
          const key = `${item.repository}#${item.number}`
          const active = key === selectedKey
          return (
            <button
              key={key}
              type="button"
              role="option"
              aria-selected={active}
              className={`github-work-item-attachment-dialog__item${active ? ' is-selected' : ''}`}
              onClick={() => setSelectedKey(key)}
            >
              <strong>{item.repository} #{item.number}</strong>
              <span>{item.title || 'Untitled work item'}</span>
              <small>{item.kind === 'pull-request' ? 'Pull request' : 'Issue'} · {item.state}</small>
            </button>
          )
        })}
      </div>
      {selected && (
        <div className="github-work-item-attachment-dialog__review" role="status">
          <strong>Review before attach</strong>
          <span>{selected.repository} #{selected.number}: {selected.title}</span>
          <span>{adopt ? `Exact head ref ${selected.headRef} matches frame branch ${frameBranch}.` : 'No exact head-ref adoption was established. This will remain an explicit node attachment.'}</span>
        </div>
      )}
    </Dialog>
  )
}
