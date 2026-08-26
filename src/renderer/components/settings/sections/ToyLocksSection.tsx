// Settings → Toy locks: the real, enumerable, individually-removable, searchable, bulk-manageable
// list every toy lock lives in. Creating a lock happens at the element itself ("Lock this
// tab/node/setting…"); this section is where they're all reviewed and taken off again. See
// docs/toy-locks.md.
import { useEffect, useMemo, useState } from 'react'
import type { ToyLockCredentialKind, ToyLockRecord } from '@shared/toylock'
import { useToyLocks } from '../../../state/toylocks'
import { ConfirmDialog } from '../../ConfirmDialog'
import { SettingsSection } from '../SettingsSection'
import { SettingsText } from '../SettingsText'
import { useVocabularyMapper } from '../../../lib/personalVocabulary/useVocabularyText'
import { SearchableRow } from '../SearchableRow'
import { Checkbox } from '@renderer/ui/md3'

const ROW = {
  title: 'Toy locks',
  keywords: ['lock', 'password', 'totp', 'authenticator', 'toy lock', 'security', 'unlock']
}

function targetKindLabel(kind: ToyLockRecord['target']['kind']): string {
  if (kind === 'tab') return 'Tab'
  if (kind === 'node') return 'Node'
  if (kind === 'group') return 'Group frame'
  return 'Setting'
}

/**
 * What this lock actually asks for, one honest phrase per credential kind.
 *
 * A `Record` keyed on the whole union — deliberately NOT the
 * `kind === 'password' ? 'Password' : 'Authenticator code'` it replaces — for exactly the reason
 * toylock-service.ts's `verify()` is an exhaustive `switch`: a two-branch shape claims every kind
 * it has never heard of. That is not hypothetical here, it had already happened twice over: a
 * `password-totp` lock (which needs BOTH factors) and a `windows-pin` lock (which needs neither a
 * TOTP app nor anything else) both printed "Authenticator code" in the one list that is supposed
 * to be the honest inventory of what is locked on this machine. A fifth credential kind now fails
 * to COMPILE here instead of silently mislabelling itself.
 *
 * Copy note: "Windows PIN", never "Windows Hello". It is a numeric password hashed like any other
 * — nodeterm has no Windows Hello prompt to call into and must not imply one (docs/toy-locks.md).
 */
const CREDENTIAL_KIND_LABELS: Record<ToyLockCredentialKind, string> = {
  password: 'Password',
  totp: 'Authenticator code',
  'password-totp': 'Password + authenticator code (both required)',
  'windows-pin': 'Windows PIN'
}

function durationLabel(record: ToyLockRecord): string {
  if (record.duration === 'minutes') return `${record.durationMinutes ?? 5} minute(s)`
  if (record.duration === 'until-close') return 'Until nodeterm quits'
  return 'This surface only'
}

export function ToyLocksSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const records = useToyLocks((s) => s.records)
  const loaded = useToyLocks((s) => s.loaded)
  const loadError = useToyLocks((s) => s.loadError)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [removeOne, setRemoveOne] = useState<ToyLockRecord | null>(null)
  const [removeBulk, setRemoveBulk] = useState(false)

  useEffect(() => {
    void useToyLocks.getState().refresh()
  }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return records
    return records.filter(
      (r) =>
        r.target.label.toLowerCase().includes(q) ||
        r.target.kind.includes(q) ||
        r.credentialKind.includes(q)
    )
  }, [records, filter])

  const toggle = (id: string): void => {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const removeIds = async (ids: string[]): Promise<void> => {
    for (const id of ids) {
      await window.nodeTerminal.toylock.remove(id)
      useToyLocks.getState().drop(id)
    }
    setSelected(new Set())
  }

  return (
    <SettingsSection
      id="toylocks"
      title="Toy locks"
      description="An opt-in password or authenticator-code lock on a tab, a node, or an appearance setting. nodeterm enforces it and keeps the credential in this computer's credential vault; it is not encryption of what sits behind it. See what's locked and remove any of them here."
      isActive={isActive}
      searchEntries={[ROW]}
    >
      <SearchableRow {...ROW}>
        <div className="space-y-3">
          {loadError && (
            <p role="alert" className="text-[13px] text-[color:var(--warn)]">
              {loadError} Existing locks could not be verified.
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={vocab('Filter locks…')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-1.5 text-[13px] text-text placeholder:text-muted"
              aria-label="Filter toy locks"
            />
            {selected.size > 0 && (
              <button
                className="shrink-0 rounded-lg border border-[color:var(--warn)] px-3 py-1.5 text-[13px] text-[color:var(--warn)]"
                onClick={() => setRemoveBulk(true)}
              >
                Remove {selected.size} selected
              </button>
            )}
          </div>

          {!loaded ? (
            <p className="text-[13px] text-muted"><SettingsText>Loading…</SettingsText></p>
          ) : loadError ? null : filtered.length === 0 ? (
            <p className="text-[13px] text-muted">
              <SettingsText>{records.length === 0
                ? 'Nothing is locked yet. Right-click a tab, a node, or the Accent setting and choose “Lock this…”.'
                : 'No locks match that filter.'}</SettingsText>
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <Checkbox
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    aria-label={`${vocab('Select')} ${r.target.label} ${vocab('lock')}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text">
                      🔒 {r.target.label}{' '}
                      <span className="font-normal text-muted">({targetKindLabel(r.target.kind)})</span>
                    </div>
                    <div className="text-[12px] text-muted">
                      <SettingsText segments={[
                        { kind: 'copy', value: CREDENTIAL_KIND_LABELS[r.credentialKind] },
                        { kind: 'copy', value: ' · ' },
                        { kind: 'fact', value: durationLabel(r) },
                        { kind: 'copy', value: ' · ' },
                        { kind: 'copy', value: r.lockedOnLaunch ? 'locked on launch' : 'stays as unlocked as you left it' }
                      ]} />
                    </div>
                  </div>
                  <button
                    className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-[12px] text-text hover:border-[color:var(--warn)] hover:text-[color:var(--warn)]"
                    onClick={() => setRemoveOne(r)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SearchableRow>

      {removeOne && (
        <ConfirmDialog
          message={`Remove the lock on "${removeOne.target.label}"? It stops asking for a credential immediately.`}
          confirmLabel="Remove lock"
          onConfirm={() => {
            void removeIds([removeOne.id])
            setRemoveOne(null)
          }}
          onCancel={() => setRemoveOne(null)}
        />
      )}
      {removeBulk && (
        <ConfirmDialog
          message={`Remove ${selected.size} lock(s)? They stop asking for a credential immediately.`}
          confirmLabel="Remove locks"
          onConfirm={() => {
            void removeIds([...selected])
            setRemoveBulk(false)
          }}
          onCancel={() => setRemoveBulk(false)}
        />
      )}
    </SettingsSection>
  )
}
