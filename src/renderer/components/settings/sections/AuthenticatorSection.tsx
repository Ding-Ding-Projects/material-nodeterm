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
  dispatchAuthenticatorRemoval,
  planAuthenticatorRemoval,
  sameAuthenticatorEntry
} from '../../../lib/authenticatorRemoval'
import type { DestructiveAuthorization } from '../../../lib/destructiveAuthorization'
import { SettingsSection } from '../SettingsSection'
import { SettingsText } from '../SettingsText'
import { SearchableRow } from '../SearchableRow'
import { Select } from '@renderer/ui/Select'
import { Radio } from '@renderer/ui/md3'
import { useVocabularyMapper } from '../../../lib/personalVocabulary/useVocabularyText'

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
  const vocab = useVocabularyMapper()
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
          <Radio name="authenticator-entry-mode" checked={mode === 'uri'} onChange={() => setMode('uri')} /> <SettingsText>Paste a URI</SettingsText>
        </label>
        <label>
          <Radio name="authenticator-entry-mode" checked={mode === 'manual'} onChange={() => setMode('manual')} /> <SettingsText>Enter manually</SettingsText>
        </label>
      </div>
      {mode === 'uri' ? (
        <input
          type="text"
          className="toylock-input"
          placeholder={vocab('otpauth://totp/Issuer:you@example.com?secret=…')}
          value={uri}
          onChange={(e) => setUri(e.target.value)}
        />
      ) : (
        <div className="toylock-manual-grid">
          <input type="text" className="toylock-input" placeholder={vocab('Issuer (e.g. GitHub)')} value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          <input type="text" className="toylock-input" placeholder={vocab('Account (e.g. you@example.com)')} value={account} onChange={(e) => setAccount(e.target.value)} />
          <input type="text" className="toylock-input" placeholder={vocab('Secret (base32)')} value={secret} onChange={(e) => setSecret(e.target.value)} />
          <Select className="toylock-select" value={algorithm} onChange={(e) => setAlgorithm(e.target.value as OtpAlgorithm)}>
            {OTP_ALGORITHMS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
          <Select className="toylock-select" value={digits} onChange={(e) => setDigits(Number(e.target.value))}>
            {[6, 7, 8].map((d) => (
              <option key={d} value={d}>
                {d} digits
              </option>
            ))}
          </Select>
          <input
            type="number"
            className="toylock-number"
            min={1}
            value={period}
            onChange={(e) => setPeriod(Math.max(1, Number(e.target.value) || 30))}
            aria-label={vocab('Period in seconds')}
          />
        </div>
      )}
      {error && <div className="toylock-error">{error}</div>}
      <button className="toylock-btn toylock-btn--primary" disabled={busy} onClick={() => void submit()}>
        <SettingsText>{busy ? 'Adding…' : 'Add'}</SettingsText>
      </button>
    </div>
  )
}

function EntryRow({
  entry,
  code,
  readCurrentEntry,
  onRemoved,
  onRenamed,
  onRefreshed,
  onRemovalError
}: {
  entry: AuthenticatorEntry
  code: AuthenticatorCode | undefined
  readCurrentEntry: (id: string) => AuthenticatorEntry | null
  onRemoved: () => void
  onRenamed: (next: AuthenticatorEntry) => void
  onRefreshed: (entries: AuthenticatorEntry[]) => void
  onRemovalError: (error: string | null) => void
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [confirmRemove, setConfirmRemove] = useState<{
    message: string
    onConfirm: () => void
    onCancel?: () => void
  } | null>(null)
  const [removing, setRemoving] = useState(false)
  const removalInFlight = useRef(false)
  const [renaming, setRenaming] = useState(false)
  const [issuer, setIssuer] = useState(entry.issuer)
  const [account, setAccount] = useState(entry.account)
  const [revealed, setRevealed] = useState<{ secretBase32: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const secondsRemaining = code ? Math.max(0, code.periodStart + code.period - Math.floor(Date.now() / 1000)) : 0
  // Purely presentational: how far around the period this code has already travelled, fed to a
  // conic-gradient countdown ring below. Nothing reads this back for a timing decision.
  const ringDegrees = code ? Math.round(((code.period - secondsRemaining) / code.period) * 360) : 0

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

  const requestRemoval = (
    disclosed: AuthenticatorEntry,
    gateRequired = kidsDestructiveGateRequired()
  ): boolean => {
    const opened = dispatchAuthenticatorRemoval(planAuthenticatorRemoval(disclosed, gateRequired), {
      perform: (authorization) => void commitRemoval(disclosed, authorization),
      cancel: () => setConfirmRemove(null),
      openGate: openDestructiveGate,
      openConfirm(request) {
        setConfirmRemove(request)
        return true
      }
    })
    if (!opened) onRemovalError('Another destructive confirmation is already open. Try again after it closes.')
    return opened
  }

  const commitRemoval = async (
    disclosed: AuthenticatorEntry,
    authorization: DestructiveAuthorization
  ): Promise<void> => {
    if (removalInFlight.current) return
    removalInFlight.current = true
    setRemoving(true)
    setConfirmRemove(null)
    onRemovalError(null)
    try {
      // Confirmation may remain open across a store write. Re-read the authoritative store rather
      // than treating the row React rendered earlier as a capability for whichever entry owns the
      // same id now.
      const latest = await window.nodeTerminal.authenticator.list()
      const current = latest.find((candidate) => candidate.id === disclosed.id)
      if (!current) {
        onRefreshed(latest)
        onRemovalError('That authenticator entry no longer exists. Nothing was removed.')
        return
      }
      if (!sameAuthenticatorEntry(disclosed, current)) {
        onRefreshed(latest)
        onRemovalError('That authenticator entry changed while confirmation was open. Review it and try again.')
        return
      }

      // A plain confirmation cannot survive Kids policy becoming ON or unavailable. Re-open from
      // the freshly-read entry under the stronger gate. A completed two-key approval stays strong
      // if the policy later relaxes.
      if (authorization === 'ordinary' && kidsDestructiveGateRequired()) {
        requestRemoval(current, true)
        return
      }

      // No await belongs between this last policy decision and the core mutation request. Core
      // spends the exact revision inside SecureStore.mutate, which is the final authoritative CAS
      // against a rename/replacement in this remaining IPC interval.
      const result = await window.nodeTerminal.authenticator.remove({
        id: current.id,
        revision: current.revision
      })
      if (!result.ok) {
        onRemovalError(result.message)
        const refreshed = await window.nodeTerminal.authenticator.list()
        onRefreshed(refreshed)
        return
      }
      onRemoved()
    } catch {
      onRemovalError('Could not verify and remove that authenticator entry. Nothing was assumed removed.')
    } finally {
      removalInFlight.current = false
      setRemoving(false)
    }
  }

  return (
    <li className="toylock-auth-row">
      <span className="md3-auth-avatar" aria-hidden="true">
        {(entry.issuer.trim().charAt(0) || '?').toUpperCase()}
      </span>
      <div className="toylock-auth-row__id">
        {renaming ? (
          <div className="toylock-manual-grid toylock-manual-grid--2col">
            <input className="toylock-input" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder={vocab('Issuer')} />
            <input className="toylock-input" value={account} onChange={(e) => setAccount(e.target.value)} placeholder={vocab('Account')} />
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
            <span
              className="md3-auth-ring"
              aria-hidden="true"
              style={{ '--md3-ring-deg': `${ringDegrees}deg` } as React.CSSProperties}
            />
            <button
              className="toylock-code-text"
              onClick={copyCode}
              aria-label={`${vocab('Copy current code')} ${code.code}`}
              title={vocab('Copy code')}
            >
              <span aria-live="polite">{groupDigits(code.code)}</span>
            </button>
            <span className="toylock-hint" aria-hidden="true">
              {secondsRemaining}s · next {groupDigits(code.next)}
            </span>
            <span className="sr-only" aria-live="off">
              New code in {secondsRemaining} seconds
            </span>
            {copied && <span className="toylock-hint"><SettingsText>Copied</SettingsText></span>}
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
              <SettingsText>Save</SettingsText>
            </button>
            <button className="toylock-btn toylock-btn--sm" onClick={() => setRenaming(false)}>
              <SettingsText>Cancel</SettingsText>
            </button>
          </>
        ) : (
          <>
            <button className="toylock-btn toylock-btn--sm" onClick={() => setRenaming(true)}>
              <SettingsText>Rename</SettingsText>
            </button>
            <button className="toylock-btn toylock-btn--sm" onClick={() => void reveal()}>
              <SettingsText>Reveal secret</SettingsText>
            </button>
            <button
              className="toylock-btn toylock-btn--sm"
              disabled={removing}
              onClick={() => requestRemoval(entry)}
            >
              <SettingsText>{removing ? 'Removing…' : 'Remove'}</SettingsText>
            </button>
          </>
        )}
      </div>
      {revealed && (
        <div className="toylock-manual-secret">
          <span className="toylock-field__label"><SettingsText>Secret for</SettingsText>{' '}{entry.issuer} — {entry.account}</span>
          <code className="toylock-secret-text">{revealed.secretBase32.replace(/(.{4})/g, '$1 ').trim()}</code>
          <button className="toylock-btn toylock-btn--sm" onClick={() => setRevealed(null)}>
            <SettingsText>Hide</SettingsText>
          </button>
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          message={confirmRemove.message}
          confirmLabel="Remove"
          onConfirm={() => {
            const confirm = confirmRemove.onConfirm
            setConfirmRemove(null)
            confirm()
          }}
          onCancel={() => {
            confirmRemove.onCancel?.()
            setConfirmRemove(null)
          }}
        />
      )}
    </li>
  )
}

export function AuthenticatorSection({ isActive }: { isActive: boolean }): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [entries, setEntries] = useState<AuthenticatorEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [codes, setCodes] = useState<Record<string, AuthenticatorCode>>({})
  const [filter, setFilter] = useState('')
  const [showExportGate, setShowExportGate] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportedFile, setExportedFile] = useState<string | null>(null)
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  useEffect(() => {
    void window.nodeTerminal.authenticator
      .list()
      .then((next) => {
        setEntries(next)
        setLoadError(null)
      })
      .catch(() => setLoadError('Could not read the authenticator credential store.'))
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
        <div className="md3-authenticator">
          {loadError && (
            <div role="alert" className="toylock-error">
              {loadError} Existing entries could not be verified.
            </div>
          )}
          {mutationError && (
            <div role="alert" className="toylock-error">
              {mutationError}
            </div>
          )}
          <AddEntryForm onAdded={(e) => setEntries((cur) => [...cur, e])} />
          <input
            type="text"
            placeholder={vocab('Filter entries…')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="md3-authenticator__filter"
            aria-label={vocab('Filter authenticator entries')}
          />
          {loadError ? null : filtered.length === 0 ? (
            <p className="md3-authenticator__empty"><SettingsText>No entries yet.</SettingsText></p>
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
                  onRefreshed={setEntries}
                  onRemovalError={setMutationError}
                />
              ))}
            </ul>
          )}

          {entries.length > 0 && (
            <div className="toylock-export-section">
              <h4 className="md3-authenticator__export-title"><SettingsText>Export secrets</SettingsText></h4>
              <p className="md3-authenticator__export-body">
                <SettingsText>Ordinary exports (backups, sharing) never include these secrets. This is the ONE deliberate action that writes them out, in the clear, behind a real two-key gate.</SettingsText>
              </p>
              {!showExportGate ? (
                <button className="toylock-btn" onClick={() => setShowExportGate(true)}>
                  <SettingsText>Export all secrets…</SettingsText>
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
