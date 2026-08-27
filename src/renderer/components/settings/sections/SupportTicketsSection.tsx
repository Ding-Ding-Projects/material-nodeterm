// Support Tickets: the toy-lock recovery route, dressed as a support desk that plays the part
// properly right up until the "resolution", which does the one thing that actually works —
// opening the app's local application-data folder so the user can delete it themselves. See
// docs/toy-locks.md.
import { useEffect, useMemo, useState } from 'react'
import { useSupportTickets, type SupportTicket, type TicketStatus } from '../../../state/supportTickets'
import { isBrowserRuntime } from '../../../bridge/runtime'
import { SettingsSection } from '../SettingsSection'
import { SettingsText } from '../SettingsText'
import { useVocabularyMapper } from '../../../lib/personalVocabulary/useVocabularyText'
import { SearchableRow } from '../SearchableRow'
import { TextArea } from '@renderer/ui/md3'
import { Select } from '@renderer/ui/Select'

const ROW = {
  title: 'Support Tickets',
  keywords: ['support', 'ticket', 'locked out', 'forgot password', 'recovery', 'help', 'reset']
}

const CATEGORIES = [
  'Locked out of a tab',
  'Locked out of a node',
  'Locked out of a setting',
  'The lock is being a bit much, honestly',
  'General nodeterm question',
  'Other'
]

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  'in-review': 'In review',
  resolved: 'Resolved'
}

const CANNED_RESPONSE: Record<TicketStatus, string> = {
  open: 'Ticket received. A completely fictional agent has been assigned and is reviewing your case with the gravity it deserves.',
  'in-review':
    "Your ticket has been escalated to Tier 2 (there is no Tier 1). We're pulling up your account, which is this computer.",
  resolved: 'Resolution found. See below.'
}

function TicketRow({ ticket }: { ticket: SupportTicket }): React.JSX.Element {
  const advance = useSupportTickets((s) => s.advance)
  const remove = useSupportTickets((s) => s.remove)
  const [dir, setDir] = useState<string | null>(null)
  const canOpenFolder = !isBrowserRuntime()

  useEffect(() => {
    if (ticket.status !== 'resolved') return
    let cancelled = false
    void window.nodeTerminal.userDataDir().then((d) => {
      if (!cancelled) setDir(d)
    })
    return () => {
      cancelled = true
    }
  }, [ticket.status])

  const openFolder = (): void => {
    if (dir) window.nodeTerminal.shell.openPath(dir)
  }
  const copyPath = (): void => {
    if (dir) window.nodeTerminal.clipboard.writeText(dir)
  }

  return (
    <li className="toylock-ticket">
      <div className="toylock-ticket__head">
        <span className="toylock-ticket__number">{ticket.number}</span>
        <span className="toylock-ticket__status">{STATUS_LABEL[ticket.status]}</span>
        <span className="toylock-ticket__severity">{ticket.severity}</span>
      </div>
      <div className="toylock-ticket__category">{ticket.category}</div>
      {ticket.description && <p className="toylock-ticket__desc">{ticket.description}</p>}
      <p className="toylock-hint">{CANNED_RESPONSE[ticket.status]}</p>

      {ticket.status !== 'resolved' ? (
        <button className="toylock-btn toylock-btn--sm" onClick={() => advance(ticket.id)}>
          <SettingsText>Check for updates</SettingsText>
        </button>
      ) : (
        <div className="toylock-resolution">
          <p className="toylock-recovery__how">
            <SettingsText>Delete nodeterm's local application-data folder and every toy lock resets:</SettingsText>
          </p>
          <div className="toylock-recovery__path-row">
            <code className="toylock-recovery__path">{dir ?? '…'}</code>
            <button className="toylock-btn toylock-btn--sm" onClick={copyPath} disabled={!dir}>
              <SettingsText>Copy path</SettingsText>
            </button>
            {canOpenFolder && (
              <button className="toylock-btn toylock-btn--sm toylock-btn--primary" onClick={openFolder} disabled={!dir}>
                <SettingsText>Open folder</SettingsText>
              </button>
            )}
          </div>
          {!canOpenFolder && (
            <p className="toylock-hint">
              <SettingsText>Opening a folder isn't available from a browser tab — delete this path on the server itself.</SettingsText>
            </p>
          )}
          <p className="toylock-hint">
            <SettingsText>This app never deletes it for you — it just opens the folder and stands back.</SettingsText>
          </p>
        </div>
      )}
      <button className="toylock-btn--link" onClick={() => remove(ticket.id)}>
        <SettingsText>Close ticket</SettingsText>
      </button>
    </li>
  )
}

export function SupportTicketsSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const tickets = useSupportTickets((s) => s.tickets)
  const create = useSupportTickets((s) => s.create)
  const [category, setCategory] = useState(CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<SupportTicket['severity']>('low')
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return tickets
    return tickets.filter(
      (t) => t.number.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    )
  }, [tickets, filter])

  const submit = (): void => {
    create(category, description, severity)
    setDescription('')
  }

  const exportAll = (): void => {
    const body = tickets
      .map((t) => `${t.number}\t${STATUS_LABEL[t.status]}\t${t.severity}\t${t.category}\t${t.description}`)
      .join('\n')
    window.nodeTerminal.clipboard.writeText(body)
  }

  return (
    <SettingsSection
      id="support"
      title="Support Tickets"
      description="The recovery route for a toy lock, played completely straight, right up until the punchline."
      isActive={isActive}
      searchEntries={[ROW]}
    >
      <SearchableRow {...ROW}>
        <div className="space-y-4">
          <div className="toylock-support-disclosure">
            <SettingsText>Nothing on this page is sent anywhere. There is no ticket outside this computer, no network request is made, no data is collected, and nobody is reading it.</SettingsText>
          </div>

          <div className="toylock-add-entry">
            <Select className="toylock-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  <SettingsText>{c}</SettingsText>
                </option>
              ))}
            </Select>
            <TextArea
              className="toylock-textarea"
              placeholder="Describe your issue (optional — we're not going to read it either way)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <Select
              className="toylock-select"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as SupportTicket['severity'])}
            >
              <option value="low"><SettingsText>Low</SettingsText></option>
              <option value="medium"><SettingsText>Medium</SettingsText></option>
              <option value="high"><SettingsText>High</SettingsText></option>
              <option value="critical-but-not-really"><SettingsText>Critical (nobody will honour this)</SettingsText></option>
            </Select>
            <button className="toylock-btn toylock-btn--primary" onClick={submit}>
              <SettingsText>Submit ticket</SettingsText>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={vocab('Filter tickets…')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 text-[13px] text-text placeholder:text-muted"
              aria-label={vocab('Filter support tickets')}
            />
            {tickets.length > 0 && (
              <button className="toylock-btn toylock-btn--sm" onClick={exportAll}>
                <SettingsText>Copy all as text</SettingsText>
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <p className="text-[13px] text-muted"><SettingsText>No tickets yet.</SettingsText></p>
          ) : (
            <ul className="toylock-ticket-list">
              {filtered.map((t) => (
                <TicketRow key={t.id} ticket={t} />
              ))}
            </ul>
          )}
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
