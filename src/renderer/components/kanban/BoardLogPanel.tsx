import { useEffect, useRef, useState } from 'react'
import type { BoardLogEntry, BoardLogEvent } from '@shared/types'
import { BOARD_ATTACHMENT_LIMITS, detectBoardAttachmentKind, type BoardAttachmentDraft, type BoardAttachmentRef } from '@shared/comment-attachments'
import { formatTimeAgo } from '../../lib/usageFormat'
import { useSession } from '../../session/session'
import { useProjects } from '../../state/projects'
import { useBoardLog } from '../../state/boardLog'
import type { KanbanSession } from './KanbanView'
import { Button, TextArea } from '@renderer/ui/md3'

interface BoardLogPanelProps {
  /** The card/node whose activity this panel shows — feed + composer are scoped to `card.id`.
   *  Only the id is needed, so the canvas node flyout can use this panel without building a
   *  full KanbanSession. */
  card: Pick<KanbanSession, 'id'>
}

/** The activity sentence WITHOUT the leading author name — the name is rendered separately in
 *  the author's color, so the feed reads like Trello (colored actor + muted action). column-*
 *  events carry no nodeId and so never reach a card-scoped feed; kept for completeness. */
export function eventBody(e: BoardLogEvent): string {
  switch (e.type) {
    case 'card-created':
      return `created this card in ${e.to ?? 'Ungrouped'}`
    case 'card-moved':
      return `moved this card ${e.from ?? 'Ungrouped'} → ${e.to ?? 'Ungrouped'}`
    case 'column-added':
      return `added column ${e.title ?? ''}`.trimEnd()
    case 'column-renamed':
      return `renamed column ${e.from ?? ''} → ${e.to ?? ''}`
    case 'column-deleted':
      return `deleted column ${e.title ?? ''}`.trimEnd()
    case 'member-assigned':
      return `assigned ${e.to ?? 'someone'}`
    case 'member-unassigned':
      return `removed ${e.to ?? 'someone'}`
    case 'due-set':
      return `set the due date → ${e.to ? formatStamp(Date.parse(e.to)) : ''}`.trimEnd()
    case 'due-cleared':
      return `removed the due date`
    case 'priority-set':
      return `set priority → ${e.to ?? ''}`.trimEnd()
    case 'priority-cleared':
      return `removed the priority`
    case 'agent-message':
      return `sent a message to ${e.to ?? 'another node'} (${e.title ?? 'unknown outcome'})`
    case 'agent-read-cookies':
      // A loud, human-visible line for a cookie read (the whole point of the trace). `from` names the
      // agent, `to` the domain it read; `title` names the browser node it drove.
      return `read cookies for ${e.to ?? 'a site'}${e.title ? ` via ${e.title}` : ''}`
    default:
      // A newer peer may write event types this build doesn't know — show them neutrally.
      return `updated this card`
  }
}

/** Absolute, Trello-style stamp ("19 Jul 2026, 22:50") — the feed shows dates, not "2h ago"
 *  (the relative form stays in the row's tooltip). */
function formatStamp(ts: number): string {
  if (!Number.isFinite(ts)) return ''
  return new Date(ts).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Right panel of the card modal (all card kinds): a composer on top and the card's own
 *  comments + activity feed newest-first. Reads/writes the board log for the ACTIVE project via
 *  its session api — resolved here (not threaded from Canvas). Subscribes on mount, so a teammate's
 *  comment or a board change lands live; unsubscribes on unmount / card swap. */
export function BoardLogPanel({ card }: BoardLogPanelProps) {
  const { api } = useSession()
  const projectId = useProjects((s) => s.activeProjectId)
  const entries = useBoardLog((s) => s.entriesFor(projectId))
  const unsupported = useBoardLog((s) => !!s.unsupportedByProject[projectId])
  const error = useBoardLog((s) => !!s.errorByProject[projectId])
  const [draft, setDraft] = useState('')
  const [queue, setQueue] = useState<QueuedAttachment[]>([])
  const queueRef = useRef<QueuedAttachment[]>([])
  const [posting, setPosting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)

  const updateQueue = (next: QueuedAttachment[] | ((current: QueuedAttachment[]) => QueuedAttachment[])): void => {
    setQueue((current) => {
      const value = typeof next === 'function' ? next(current) : next
      queueRef.current = value
      return value
    })
  }

  useEffect(() => () => {
    for (const item of queueRef.current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
  }, [])

  useEffect(() => {
    if (!projectId) return
    void useBoardLog.getState().load(api, projectId)
    const unsub = useBoardLog.getState().subscribeChanged(api, projectId)
    return unsub
  }, [api, projectId])

  const addFiles = async (files: File[]): Promise<void> => {
    const available = Math.max(0, BOARD_ATTACHMENT_LIMITS.maxCount - queueRef.current.length)
    const selected = files.slice(0, available)
    const reserved = selected.map((file, index) => ({
      id: `${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2)}`,
      file,
      name: file.name || 'attachment',
      size: file.size,
      kind: 'file' as const,
      mime: 'application/octet-stream',
      status: 'reading' as const,
      progress: 0,
      previewUrl: undefined
    }))
    if (reserved.length === 0 && files.length > 0) {
      updateQueue((current) => current.map((item) => item.error ? item : item))
      return
    }
    updateQueue((current) => [...current, ...reserved])
    for (const item of reserved) {
      try {
        if (item.size <= 0) throw new Error('The selected file is empty.')
        if (item.size > BOARD_ATTACHMENT_LIMITS.maxBytes) throw new Error(`The selected file exceeds ${BOARD_ATTACHMENT_LIMITS.maxBytes} bytes.`)
        const head = new Uint8Array(await item.file.slice(0, 4096).arrayBuffer())
        const detected = detectBoardAttachmentKind(head)
        let sourcePath = (item.file as File & { path?: string }).path
        if (!sourcePath) {
          if (api.files.saveUploadBlob) sourcePath = await api.files.saveUploadBlob(item.name, item.file) ?? undefined
          else {
            const bytes = new Uint8Array(await item.file.arrayBuffer())
            let binary = ''
            for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
            sourcePath = await api.files.saveUpload(item.name, btoa(binary)) ?? undefined
          }
        }
        if (!sourcePath) throw new Error('The selected file could not be staged on the project host.')
        updateQueue((current) => current.map((entry) => entry.id === item.id ? {
          ...entry,
          kind: detected.kind,
          mime: detected.mime,
          status: 'ready',
          progress: 1,
          sourcePath,
          previewUrl: detected.kind === 'file' ? undefined : URL.createObjectURL(item.file)
        } : entry))
      } catch (error) {
        const failure = error instanceof Error ? error : new Error('The selected file could not be read.')
        updateQueue((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'failed', error: failure } : entry))
      }
    }
  }

  useEffect(() => {
    const node = composer.current
    if (!node) return
    const onPaste = (event: ClipboardEvent): void => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0) return
      event.preventDefault()
      void addFiles(files)
    }
    node.addEventListener('paste', onPaste)
    return () => node.removeEventListener('paste', onPaste)
  })

  const removeQueued = (id: string): void => {
    const item = queueRef.current.find((candidate) => candidate.id === id)
    if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
    updateQueue((current) => current.filter((candidate) => candidate.id !== id))
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    const ready = queueRef.current.filter((item) => item.status === 'ready' && item.sourcePath)
    if ((!text && ready.length === 0) || posting || queueRef.current.some((item) => item.status === 'reading')) return
    setPosting(true)
    const attachments: BoardAttachmentDraft[] = ready.map((item) => ({ name: item.name, sourcePath: item.sourcePath! }))
    const result = await useBoardLog.getState().appendWithAttachments(api, projectId, { kind: 'comment', nodeId: card.id, text }, attachments)
    setPosting(false)
    if (result.ok) {
      for (const item of queueRef.current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
      updateQueue([])
      setDraft('')
    }
  }

  // Card-scoped: this card's comments + its own events. Column events (no nodeId) never match.
  const feed = (entries ?? []).filter((e) => e.nodeId === card.id)

  return (
    <div className="board-log">
      <div className="board-log__title">Comments & activity</div>
      {unsupported ? (
        <div className="board-log__hint">Board history needs a project folder</div>
      ) : (
        <TextArea
          ref={composer}
          className="board-log__composer"
          value={draft}
          placeholder="Write a comment…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline (default textarea behavior).
            // Never submit mid-IME-composition (e.g. selecting a kanji candidate with Enter).
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
        />
      )}
      {!unsupported && <div
        className="board-log__attachment-drop"
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
        onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)) }}
        aria-label="Attach files by picking, dragging, or pasting"
      >
        <Button type="button" variant="tonal" disabled={posting} onClick={() => fileInput.current?.click()}>Attach files</Button>
        <input ref={fileInput} className="board-log__file-input" type="file" multiple onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = '' }} aria-label="Choose files to attach" />
        <span>Drop files here or paste from the clipboard</span>
      </div>}
      {queue.length > 0 && <div className="board-log__attachment-queue" role="list" aria-label="Pending comment attachments">
        {queue.map((item) => <QueuedAttachmentRow key={item.id} item={item} onRemove={() => removeQueued(item.id)} />)}
      </div>}
      {!unsupported && <Button type="button" variant="filled" disabled={posting || queue.some((item) => item.status === 'reading')} onClick={() => void send()}>{posting ? 'Posting…' : 'Post comment'}</Button>}
      {!unsupported && error && (
        <div className="board-log__error">Some board history couldn’t be saved.</div>
      )}
      <div className="board-log__feed">
        {feed.map((entry) => (
          <FeedRow key={entry.id} entry={entry} api={api} projectId={projectId} />
        ))}
      </div>
    </div>
  )
}

interface QueuedAttachment {
  id: string
  file: File
  name: string
  size: number
  kind: 'file' | 'image' | 'audio' | 'video'
  mime: string
  status: 'reading' | 'ready' | 'failed'
  progress: number
  sourcePath?: string
  previewUrl?: string
  error?: Error
}

function QueuedAttachmentRow({ item, onRemove }: { item: QueuedAttachment; onRemove: () => void }): React.JSX.Element {
  return <div className="board-log__attachment-row" role="listitem" aria-label={`${item.name}, ${item.size} bytes, ${item.status}`}>
    {item.previewUrl && item.kind === 'image' ? <img src={item.previewUrl} alt={`Preview of ${item.name}`} /> : <span className="board-log__attachment-icon" aria-hidden="true">{item.kind === 'audio' ? '♫' : item.kind === 'video' ? '▶' : '▧'}</span>}
    <span className="board-log__attachment-name" title={item.name}>{item.name}</span>
    <span className="board-log__attachment-size">{formatAttachmentBytes(item.size)}</span>
    <span className={`board-log__attachment-status board-log__attachment-status--${item.status}`} role="status">{item.error?.message ?? item.status}</span>
    <progress className="board-log__attachment-progress" max={1} value={item.progress} aria-label={`Reading ${item.name}`} />
    {item.previewUrl && item.kind === 'audio' ? <audio src={item.previewUrl} controls preload="metadata" aria-label={`Preview ${item.name}`} /> : null}
    {item.previewUrl && item.kind === 'video' ? <video src={item.previewUrl} controls preload="metadata" aria-label={`Preview ${item.name}`} /> : null}
    <Button type="button" variant="text" onClick={onRemove} aria-label={`Remove ${item.name}`}>Remove</Button>
  </div>
}

function formatAttachmentBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function FeedRow({ entry, api, projectId }: { entry: BoardLogEntry; api: import('@shared/types').NodeTerminalApi; projectId: string }) {
  const when = formatStamp(entry.ts)
  const whenAgo = formatTimeAgo(entry.ts)
  if (entry.kind === 'event' && entry.event) {
    return (
      <div className="board-log__event" title={whenAgo}>
        <span className="board-log__dot" style={{ background: entry.author.color }} />
        <span className="board-log__author" style={{ color: entry.author.color }}>
          {entry.author.name}
        </span>{' '}
        <span className="board-log__event-body">{eventBody(entry.event)}</span>
        <span className="board-log__time">{when}</span>
      </div>
    )
  }
  return (
    <div className="board-log__comment">
      <div className="board-log__meta">
        <span className="board-log__dot" style={{ background: entry.author.color }} />
        <span className="board-log__author" style={{ color: entry.author.color }}>
          {entry.author.name}
        </span>
        <span className="board-log__time" title={whenAgo}>{when}</span>
      </div>
      <div className="board-log__text">{entry.text}</div>
      {entry.attachments?.length ? <div className="board-log__posted-attachments" role="list" aria-label="Comment attachments">{entry.attachments.map((attachment) => <PostedAttachment key={attachment.id} attachment={attachment} api={api} projectId={projectId} />)}</div> : null}
    </div>
  )
}

function PostedAttachment({ attachment, api, projectId }: { attachment: BoardAttachmentRef; api: import('@shared/types').NodeTerminalApi; projectId: string }): React.JSX.Element {
  const [url, setUrl] = useState<string>()
  const [error, setError] = useState<string>()
  const urlRef = useRef<string>()
  useEffect(() => {
    let alive = true
    void api.boardLog.readAttachment(projectId, attachment).then((result) => {
      if (!alive) return
      if (!result.ok) { setError(result.message); return }
      const binary = atob(result.dataBase64)
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      const nextUrl = URL.createObjectURL(new Blob([bytes], { type: result.attachment.mime }))
      urlRef.current = nextUrl
      setUrl(nextUrl)
    }).catch(() => { if (alive) setError('Attachment could not be read.') })
    return () => { alive = false; if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = undefined } }
  }, [api, attachment, projectId])
  if (error) return <span className="board-log__attachment-error" role="status">{attachment.name}: {error}</span>
  return <div className="board-log__posted-attachment" role="listitem">
    {url && attachment.kind === 'image' ? <img src={url} alt={attachment.name} /> : null}
    {url && attachment.kind === 'audio' ? <audio src={url} controls preload="metadata" aria-label={attachment.name} /> : null}
    {url && attachment.kind === 'video' ? <video src={url} controls preload="metadata" aria-label={attachment.name} /> : null}
    <a href={url} download={attachment.name} aria-label={`Download ${attachment.name}`}>{attachment.name}</a>
    <span>{formatAttachmentBytes(attachment.bytes)}</span>
  </div>
}
