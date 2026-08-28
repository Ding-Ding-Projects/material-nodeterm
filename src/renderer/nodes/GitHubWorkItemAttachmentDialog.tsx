import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubWorkItem } from '@shared/github-work-items'
import { canAdoptPullRequestOnFrame, githubPullRequestFromApiItem } from '@shared/github-work-items'
import { Dialog } from '../ui/md3/Dialog'
import { TextField } from '../ui/md3/TextField'
import { useRegexSearchField } from '../lib/regex/useRegexSearchField'
import { AnchoredRegexBuilder } from '../components/regex/AnchoredRegexBuilder'

export interface GitHubWorkItemAttachmentDialogProps {
  open: boolean
  targetNodeId: string
  projectId: string
  repository?: string
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
  projectId,
  repository,
  frameId,
  frameBranch,
  items,
  onClose,
  onAttach
}: GitHubWorkItemAttachmentDialogProps): React.JSX.Element | null {
  const search = useRegexSearchField()
  const searchRef = useRef<HTMLInputElement>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [pullRequests, setPullRequests] = useState<GitHubWorkItem[]>([])
  const [providerState, setProviderState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')
  const [providerError, setProviderError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setSelectedKey(null)
    setPullRequests([])
    setProviderError(null)
    if (!repository || !projectId) {
      setProviderState('unavailable')
      return
    }
    let cancelled = false
    const load = async (): Promise<void> => {
      setProviderState('loading')
      try {
        const collected: GitHubWorkItem[] = []
        let page = 1
        let partial = false
        for (let requestCount = 0; requestCount < 3 && !cancelled; requestCount += 1) {
          const result = await window.nodeTerminal.githubApi.execute({
            operation: 'pull-request.list',
            projectId,
            page,
            params: { repository, perPage: 100 }
          })
          for (const item of result.items.slice(0, 100)) {
            const normalized = githubPullRequestFromApiItem(item, repository)
            if (normalized) collected.push(normalized)
          }
          if (result.items.length > 100) partial = true
          partial = partial || result.partial
          const hasNextPage = typeof result.nextPage === 'number' && result.nextPage > page
          if (!hasNextPage) break
          // The three-page ceiling is a deliberate resource bound. A provider continuation after
          // the last allowed request means the visible list is partial even when the provider did
          // not label its own page that way.
          if (requestCount === 2) {
            partial = true
            break
          }
          page = result.nextPage as number
        }
        if (cancelled) return
        const bounded = collected.slice(0, 300)
        if (bounded.length < collected.length) partial = true
        setPullRequests(bounded)
        if (partial) setProviderError('The approved GitHub API returned a bounded partial pull-request list. Refresh to try again.')
        setProviderState('ready')
      } catch (error) {
        if (cancelled) return
        setProviderError(error instanceof Error ? error.message : 'Pull requests are unavailable from the approved GitHub API.')
        setProviderState('unavailable')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [open, projectId, repository])
  const availableItems = useMemo(() => {
    const seen = new Set<string>()
    return [...items, ...pullRequests].filter((item) => {
      const key = `${item.repository}#${item.number}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 500)
  }, [items, pullRequests])
  const filteredItems = useMemo(() => {
    const query = search.query.trim().toLocaleLowerCase()
    const source = availableItems
    if (!query) return source
    return source.filter((item) => {
      const text = `${item.repository} #${item.number} ${item.title}`
      return search.mode === 'regex' && !search.error ? search.test(text) : text.toLocaleLowerCase().includes(query)
    })
  }, [availableItems, search.error, search.flags, search.mode, search.pattern, search.query, search.test])
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
        supportText={search.error ?? (providerState === 'loading' ? 'Loading provider-backed issues and pull requests…' : providerError ?? `${filteredItems.length} provider-backed item${filteredItems.length === 1 ? '' : 's'} available`)}
        invalid={!!search.error}
      />
      <div id="github-work-item-attachment-results" className="github-work-item-attachment-dialog__list" role="listbox" aria-label="Provider-backed GitHub work items">
        {filteredItems.length === 0 ? (
          <p className="github-work-item-attachment-dialog__empty" role="status">
            {providerState === 'loading' ? 'Loading provider-backed issues and pull requests…' : providerState === 'unavailable' ? 'Provider-backed work items are unavailable. Check the approved GitHub API capability, then reopen this guide.' : 'No provider-backed work items are available. Refresh the GitHub issue surface, then reopen this guide.'}
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
