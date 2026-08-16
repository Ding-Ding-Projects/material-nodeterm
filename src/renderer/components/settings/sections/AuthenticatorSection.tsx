// The built-in authenticator (docs/authenticator.md): register arbitrary TOTP secrets, read live
// codes, and — behind a real two-key gate — export them. Entirely local: no account, no network
// call, no telemetry. Registration supports pasting an `otpauth://totp/...` URI or typing the
// secret in by hand; camera/QR-photo scanning is a known, documented gap (see the doc).
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AuthenticatorCode, AuthenticatorEntry, OtpAlgorithm } from '@shared/authenticator'
import { OTP_ALGORITHMS } from '@shared/otp'
import { ConfirmDialog } from '../../ConfirmDialog'
import { TwoKeyExportGate } from '../../authenticator/TwoKeyExportGate'
import { openDestructiveGate } from '../../../state/destructiveGate'
import { kidsDestructiveGateRequired } from '../../../state/kidsMode'
import {
  authenticatorRemovalTargetIdentity,
  dispatchAuthenticatorRemoval,
  planAuthenticatorRemoval,
  type AuthenticatorRemovalDispatchDeps
} from '../../../lib/authenticatorRemoval'
import {
  createDestructiveCommitBarrier,
  type DestructiveAuthorization
} from '../../../lib/destructiveAuthorization'
import { SettingsSection } from '../SettingsSection'
import { SearchableRow } from '../SearchableRow'

const ROW = {
  title: 'Authenticator',
  keywords: ['totp', 'authenticator', '2fa', 'otp', 'code', 'qr', 'two factor', 'mfa']
}

/** Grouped for readability: "123 456" instead of "123456". */
function groupDigits(code: string): string {
  const mid = Math.ceil(code.length / 2)
  return `${code.slice(0, mid)} ${code.slice(mid)}`
}

function AddEntryForm({ onAdded }: { onAdded: (entry: AuthenticatorEntry) => void }): React.JSX.Element {
  const [mode, setMode] = useState<'uri' | 'manual'>('uri')
  const [uri, setUri] = useState('')
  const [issuer, setIssuer] = useState('')
  const [account, setAccount] = useState('')
  const [secret, setSecret] = useState('')
  const [algorithm, setAlgorithm] = useState<OtpAlgorithm>('SHA1')
  const [digits, setDigits] = useState(6)
  const [period, setPeriod] = useState(30)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const res =
        mode === 'uri'
          ? await window.nodeTerminal.authenticator.addFromUri(uri)
          : await window.nodeTerminal.authenticator.addManual({ issuer, account, secretBase32: secret, algorithm, digits, period })
      if (!res.ok) {
        setError(res.error)
        return
      }
      onAdded(res.entry)
      setUri('')
      setIssuer('')
      setAccount('')
      setSecret('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="toylock-add-entry">
      <div className="toylock-radio-row">
        <label>
          <input type="radio" checked={mode === 'uri'} onChange={() => setMode('uri')} /> Paste a URI
        </label>
        <label>
          <input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} /> Enter manually
        </label>
      </div>
      {mode === 'uri' ? (
        <input
          type="text"
          className="toylock-input"
          placeholder="otpauth://totp/Issuer:you@example.com?secret=…"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
        />
      ) : (
        <div className="toylock-manual-grid">
          <input type="text" className="toylock-input" placeholder="Issuer (e.g. GitHub)" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          <input type="text" className="toylock-input" placeholder="Account (e.g. you@example.com)" value={account} onChange={(e) => setAccount(e.target.value)} />
          <input type="text" className="toylock-input" placeholder="Secret (base32)" value={secret} onChange={(e) => setSecret(e.target.value)} />
          <select className="toylock-select" value={algorithm} onChange={(e) => setAlgorithm(e.target.value as OtpAlgorithm)}>
            {OTP_ALGORITHMS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select className="toylock-select" value={digits} onChange={(e) => setDigits(Number(e.target.value))}>
            {[6, 7, 8].map((d) => (
              <option key={d} value={d}>
                {d} digits
              </option>
            ))}
          </select>
          <input
            type="number"
            className="toylock-number"
            min={1}
            value={period}
            onChange={(e) => setPeriod(Math.max(1, Number(e.target.value) || 30))}
            aria-label="Period in seconds"
          />
        </div>
      )}
      {error && <div className="toylock-error">{error}</div>}
      <button className="toylock-btn toylock-btn--primary" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Adding…' : 'Add'}
      </button>
    </div>
  )
}

function EntryRow({
  entry,
  code,
  readCurrentEntry,
  onRemoved,
  onRenamed
}: {
  entry: AuthenticatorEntry
  code: AuthenticatorCode | undefined
  readCurrentEntry: (id: string) => AuthenticatorEntry | null
  onRemoved: () => void
  onRenamed: (next: AuthenticatorEntry) => void
}): React.JSX.Element {
  type PlainRemovalRequest = Parameters<AuthenticatorRemovalDispatchDeps['openConfirm']>[0]
  const [confirmRemove, setConfirmRemove] = useState<PlainRemovalRequest | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [issuer, setIssuer] = useState(entry.issuer)
  const [account, setAccount] = useState(entry.account)
  const [revealed, setRevealed] = useState<{ secretBase32: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const secondsRemaining = code ? Math.max(0, code.periodStart + code.period - Math.floor(Date.now() / 1000)) : 0

  const copyCode = (): void => {
    if (!code) return
    window.nodeTerminal.clipboard.writeText(code.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const saveRename = async (): Promise<void> => {
    const next = await window.nodeTerminal.authenticator.rename({ id: entry.id, issuer, account })
    if (next) onRenamed(next)
    setRenaming(false)
  }

  const reveal = async (): Promise<void> => {
    const res = await window.nodeTerminal.authenticator.reveal(entry.id)
    if (res.ok) setRevealed({ secretBase32: res.secretBase32 })
  }

  const requestRemove = (
    disclosedEntry: AuthenticatorEntry,
    forceTwoKey = false
  ): boolean => {
    setRemoveError(null)
    const current = readCurrentEntry(disclosedEntry.id)
    if (
      !current ||
      authenticatorRemovalTargetIdentity(current) !==
        authenticatorRemovalTargetIdentity(disclosedEntry)
    ) {
      return false
    }
    const disclosedIdentity = authenticatorRemovalTargetIdentity(current)
    const plan = planAuthenticatorRemoval(
      current,
      forceTwoKey || kidsDestructiveGateRequired()
    )
    const commitsStarted: Partial<Record<DestructiveAuthorization, boolean>> = {}
    const commit = (authorization: DestructiveAuthorization): void => {
      if (commitsStarted[authorization]) return
      commitsStarted[authorization] = true
      void window.nodeTerminal.authenticator
        .list()
        .then((liveEntries) => {
          const liveEntry = liveEntries.find((candidate) => candidate.id === current.id) ?? null
          const barrier = createDestructiveCommitBarrier({
            disclosedIdentity,
            authorization,
            readCurrent: () =>
              liveEntry
                ? {
                    identity: authenticatorRemovalTargetIdentity(liveEntry),
                    target: liveEntry,
                    kidsGateRequired: kidsDestructiveGateRequired()
                  }
                : null,
            perform: (confirmedEntry) => {
              void window.nodeTerminal.authenticator
                .remove(confirmedEntry)
                .then((result) => {
                  if (result.ok) onRemoved()
                  else setRemoveError(
                    'That authenticator entry changed or disappeared. Nothing was removed; review it and try again.'
                  )
                })
                .catch(() =>
                  setRemoveError('Could not remove that authenticator seed. Nothing was deleted.')
                )
            },
            upgradeToTwoKey: (confirmedEntry) => {
              requestRemove(confirmedEntry, true)
            },
            refuse: () =>
              setRemoveError(
                'That authenticator entry changed or disappeared. Nothing was removed; review it and try again.'
              )
          })
          barrier()
        })
        .catch(() =>
          setRemoveError(
            'The authenticator entry could not be re-read. Nothing was removed; try again.'
          )
        )
    }

    return dispatchAuthenticatorRemoval(plan, {
      perform: commit,
      openGate: (request) => openDestructiveGate(request),
      openConfirm: (request) => {
        setConfirmRemove(request)
        return true
      }
    })
  }

  return (
    <li className="toylock-auth-row">
      <div className="toylock-auth-row__id">
        {renaming ? (
          <div className="toylock-manual-grid toylock-manual-grid--2col">
            <input className="toylock-input" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuer" />
            <input className="toylock-input" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Account" />
          </div>
        ) : (
          <>
            <div className="toylock-auth-row__issuer">{entry.issuer}</div>
            <div className="toylock-auth-row__account">{entry.account}</div>
          </>
        )}
      </div>
      <div className="toylock-auth-row__code">
        {code ? (
          <>
            <button
              className="toylock-code-text"
              onClick={copyCode}
              aria-label={`Copy current code ${code.code}`}
              title="Copy code"
            >
              <span aria-live="polite">{groupDigits(code.code)}</span>
            </button>
            <span className="toylock-hint" aria-hidden="true">
              {secondsRemaining}s · next {groupDigits(code.next)}
            </span>
            <span className="sr-only" aria-live="off">
              New code in {secondsRemaining} seconds
            </span>
            {copied && <span className="toylock-hint">Copied</span>}
            {code.clockWarning && <div className="toylock-warn">{code.clockWarning}</div>}
          </>
        ) : (
          <span className="toylock-hint">…</span>
        )}
      </div>
      <div className="toylock-auth-row__actions">
        {renaming ? (
          <>
            <button className="toylock-btn toylock-btn--sm" onClick={() => void saveRename()}>
              Save
            </button>
            <button className="toylock-btn toylock-btn--sm" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="toylock-btn toylock-btn--sm" onClick={() => setRenaming(true)}>
              Rename
            </button>
            <button className="toylock-btn toylock-btn--sm" onClick={() => void reveal()}>
              Reveal secret
            </button>
            <button className="toylock-btn toylock-btn--sm" onClick={() => requestRemove(entry)}>
              Remove
            </button>
          </>
        )}
      </div>
      {removeError && <div className="toylock-error">{removeError}</div>}
      {revealed && (
        <div className="toylock-manual-secret">
          <span className="toylock-field__label">Secret for {entry.issuer} — {entry.account}</span>
          <code className="toylock-secret-text">{revealed.secretBase32.replace(/(.{4})/g, '$1 ').trim()}</code>
          <button className="toylock-btn toylock-btn--sm" onClick={() => setRevealed(null)}>
            Hide
          </button>
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          message={confirmRemove.message}
          confirmLabel="Remove"
          onConfirm={() => {
            const request = confirmRemove
            setConfirmRemove(null)
            request.onConfirm()
          }}
          onCancel={() => {
            const request = confirmRemove
            setConfirmRemove(null)
            request.onCancel?.()
          }}
        />
      )}
    </li>
  )
}

export function AuthenticatorSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const [entries, setEntries] = useState<AuthenticatorEntry[]>([])
  const [codes, setCodes] = useState<Record<string, AuthenticatorCode>>({})
  const [filter, setFilter] = useState('')
  const [showExportGate, setShowExportGate] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportedFile, setExportedFile] = useState<string | null>(null)
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  useEffect(() => {
    void window.nodeTerminal.authenticator.list().then(setEntries)
  }, [])

  // Live codes: polled once a second while this section is on screen. `authenticatorCodes` batches
  // every visible entry into one round trip rather than one per row.
  useEffect(() => {
    if (!isActive) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      const ids = entriesRef.current.map((e) => e.id)
      if (ids.length === 0) return
      const next = await window.nodeTerminal.authenticator.codes(ids)
      if (!cancelled) setCodes(next)
    }
    void tick()
    const t = setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [isActive, entries])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => e.issuer.toLowerCase().includes(q) || e.account.toLowerCase().includes(q))
  }, [entries, filter])

  const runExport = async (): Promise<void> => {
    setExportBusy(true)
    try {
      const res = await window.nodeTerminal.authenticator.exportSecrets({ ids: entries.map((e) => e.id), confirmed: true })
      if (!res.ok) return
      const body = res.entries.map((e) => `${e.issuer} — ${e.account}\n${e.otpauthUri}\n`).join('\n')
      const blob = new Blob([body], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'nodeterm-authenticator-secrets.txt'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setExportedFile('nodeterm-authenticator-secrets.txt')
      setShowExportGate(false)
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <SettingsSection
      id="authenticator"
      title="Authenticator"
      description="A local, offline place for arbitrary TOTP secrets — nothing here syncs, phones home, or leaves this machine except through the export below, which you have to unlock on purpose."
      isActive={isActive}
      searchEntries={[ROW]}
    >
      <SearchableRow {...ROW}>
        <div className="space-y-4">
          <AddEntryForm onAdded={(e) => setEntries((cur) => [...cur, e])} />
          <input
            type="text"
            placeholder="Filter entries…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-lg border border-border bg-transparent px-3 py-1.5 text-[13px] text-text placeholder:text-muted"
            aria-label="Filter authenticator entries"
          />
          {filtered.length === 0 ? (
            <p className="text-[13px] text-muted">No entries yet.</p>
          ) : (
            <ul className="toylock-auth-list">
              {filtered.map((e) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  code={codes[e.id]}
                  readCurrentEntry={(id) => entriesRef.current.find((entry) => entry.id === id) ?? null}
                  onRemoved={() => setEntries((cur) => cur.filter((x) => x.id !== e.id))}
                  onRenamed={(next) => setEntries((cur) => cur.map((x) => (x.id === next.id ? next : x)))}
                />
              ))}
            </ul>
          )}

          {entries.length > 0 && (
            <div className="toylock-export-section">
              <h4 className="text-[13px] font-medium text-text">Export secrets</h4>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                Ordinary exports (backups, sharing) never include these secrets. This is the ONE
                deliberate action that writes them out, in the clear, behind a real two-key gate.
              </p>
              {!showExportGate ? (
                <button className="toylock-btn" onClick={() => setShowExportGate(true)}>
                  Export all secrets…
                </button>
              ) : (
                <TwoKeyExportGate
                  count={entries.length}
                  busy={exportBusy}
                  onExport={() => void runExport()}
                  onCancel={() => setShowExportGate(false)}
                />
              )}
              {exportedFile && <div className="toylock-hint">Downloaded {exportedFile}.</div>}
            </div>
          )}
        </div>
      </SearchableRow>
    </SettingsSection>
  )
}
