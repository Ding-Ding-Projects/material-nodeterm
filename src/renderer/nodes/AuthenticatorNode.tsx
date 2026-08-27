import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { CanvasNode } from '../state/workspace'
import type { AuthenticatorCode, AuthenticatorEntry } from '@shared/authenticator'
import type { CredentialCode } from '@shared/password-manager'
import { useProjects } from '../state/projects'
import { nodeHeaderFillStyle } from '../lib/nodeColor'
import { EditableNodeTitle } from '../components/EditableNodeTitle'
import { useVocabularyMapper } from '../lib/personalVocabulary/useVocabularyText'

/**
 * The built-in authenticator, on the canvas.
 *
 * The generators were already there (docs/authenticator.md) and could only be READ from
 * Settings -> Just for fun -> Authenticator, which is four levels from anywhere and closed the
 * moment you went back to work. A code you need every few minutes belongs on the surface you are
 * already looking at, beside the terminal you are about to paste it into.
 *
 * WHAT THIS NODE PERSISTS: a title and a colour. Nothing else, and deliberately not a list of
 * which entries to show.
 *
 * A node's `data` is written into `.nodeterm/project.json`, which is git-shared and travels to
 * every machine that clones the repository. An entry id names a credential in THIS machine's
 * operating-system credential vault, so a list of them in there would be one person's credential
 * store leaking into everybody else's checkout - and it would be meaningless there anyway, since
 * the vault is not what git carries. This is the same rule the service nodes follow, for the same
 * reason: the node is a VIEW, and the credentials stay where they were.
 *
 * So the node shows whatever this machine's authenticator holds, exactly as the settings section
 * does. A teammate who opens the shared canvas sees their own entries, or the empty state, and
 * never a trace of yours.
 *
 * The secret itself never comes near this component. `authenticator.codes` returns the CURRENT
 * code and nothing else, computed in core against the vault; there is no path here that could
 * reveal a seed even by accident, and revealing one stays behind the settings section's own gate.
 *
 * TWO STORES, because a TOTP secret in this app can live in either and a node that read only one
 * told people with codes that they had none. The built-in authenticator is one; a password-manager
 * CREDENTIAL can carry a TOTP seed too (`CredentialSecret.totpSecretBase32`), and those live in
 * the active project's vault. Both are listed here, labelled by where they came from.
 *
 * The vault half only answers while that vault is unlocked, and says so rather than appearing
 * empty. Whether a credential even HAS a TOTP secret is part of its encrypted half, so the only
 * way to know is to ask for a code and read the `no-totp` refusal - the same thing the settings
 * panel's own viewer does, and the reason a credential without one simply does not appear.
 */
/** Seconds until this vault code rolls over, from the period the core reported rather than a
 *  local guess: the two clocks can differ, and the core's is the one that made the code. */
function vaultSecondsLeft(code: CredentialCode, now: number): number {
  const elapsed = Math.floor(now / 1000) - code.periodStart
  return Math.max(0, code.period - Math.max(0, elapsed))
}

/** One TOTP-bearing credential from the active project's password-manager vault. */
interface VaultTotpRow {
  managerId: string
  managerName: string
  credentialId: string
  label: string
  code: CredentialCode
}

export default function AuthenticatorNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const vocab = useVocabularyMapper()
  const { deleteElements, updateNodeData } = useReactFlow()
  const [entries, setEntries] = useState<AuthenticatorEntry[]>([])
  const [codes, setCodes] = useState<Record<string, AuthenticatorCode>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  // The active project's vault codes, keyed by `${managerId}/${credentialId}`. Separate state from
  // the authenticator store because the two have different lifetimes and different failure modes.
  const projectId = useProjects((s) => s.activeProjectId)
  const [vaultRows, setVaultRows] = useState<VaultTotpRow[]>([])
  const [vaultNote, setVaultNote] = useState<string | null>(null)

  const loadVault = useCallback(async (): Promise<void> => {
    if (!projectId) {
      setVaultRows([])
      setVaultNote(null)
      return
    }
    try {
      const status = await window.nodeTerminal.passwordManager.status(projectId)
      if (status.state.kind === 'unsupported' || status.state.kind === 'uninitialized') {
        setVaultRows([])
        setVaultNote(null)
        return
      }
      if (status.state.kind === 'locked') {
        // Not "no codes": the vault has some and this process cannot read them yet. Saying so is
        // the whole difference between a locked door and an empty room.
        setVaultRows([])
        setVaultNote('This project’s password manager is locked, so its codes are hidden.')
        return
      }
      setVaultNote(null)
      const rows: VaultTotpRow[] = []
      for (const manager of status.managers) {
        const listed = await window.nodeTerminal.passwordManager.listCredentials(projectId, manager.id)
        if (!listed.ok) continue
        for (const credential of listed.credentials) {
          // Whether a credential HAS a TOTP secret is inside its encrypted half, so asking for the
          // code and reading the refusal is the only way to know. A `no-totp` credential simply
          // does not appear, which is why this cannot be filtered before the call.
          const res = await window.nodeTerminal.passwordManager.credentialCode(
            projectId,
            manager.id,
            credential.id
          )
          if (res.ok) rows.push({ managerId: manager.id, managerName: manager.name, credentialId: credential.id, label: credential.label, code: res.code })
        }
      }
      setVaultRows(rows)
    } catch {
      setVaultRows([])
      setVaultNote('Could not read this project’s password manager.')
    }
  }, [projectId])

  useEffect(() => {
    void loadVault()
  }, [loadVault])

  // Refresh only the codes whose period has actually rolled over. `credentialCode` has no batched
  // sibling, so polling every credential every second would be one round trip per credential per
  // second for nothing: a TOTP code does not change between boundaries.
  useEffect(() => {
    if (vaultRows.length === 0) return
    const t = setInterval(() => {
      const nowSeconds = Math.floor(Date.now() / 1000)
      const stale = vaultRows.some((r) => nowSeconds >= r.code.periodStart + r.code.period)
      if (stale) void loadVault()
    }, 1000)
    return () => clearInterval(t)
  }, [vaultRows, loadVault])

  const load = useCallback(async (): Promise<void> => {
    try {
      setEntries(await window.nodeTerminal.authenticator.list())
      setLoadError(null)
    } catch {
      // A read failure is reported as a read failure. An empty list here would say "you have no
      // generators", which is a different and much worse thing to tell somebody who has several.
      setLoadError('Could not read this computer’s authenticator store.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // One round trip per second for every entry, the same batched call the settings section uses -
  // never one request per row. The clock ticks separately so the countdown stays smooth even if a
  // code request is slow.
  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      const ids = entriesRef.current.map((e) => e.id)
      if (ids.length === 0) return
      try {
        const next = await window.nodeTerminal.authenticator.codes(ids)
        if (!cancelled) setCodes(next)
      } catch {
        // Leave the last codes on screen rather than blanking them: a transient failure is not
        // evidence that the entries are gone, and a blank row invites a pointless retry.
      }
    }
    void tick()
    const codeTimer = setInterval(() => void tick(), 1000)
    const clockTimer = setInterval(() => setNow(Date.now()), 250)
    return () => {
      cancelled = true
      clearInterval(codeTimer)
      clearInterval(clockTimer)
    }
  }, [entries])

  const copy = useCallback(async (entryId: string, code: string): Promise<void> => {
    const ok = await window.nodeTerminal.clipboard.writeText(code)
    // Only claim a copy the clipboard actually acknowledged - `writeText` resolves false when the
    // host refused, and a green tick over a failed copy is how somebody pastes the wrong thing.
    if (ok) {
      setCopied(entryId)
      setTimeout(() => setCopied((c) => (c === entryId ? null : c)), 1200)
    }
  }, [])

  const headerFill = nodeHeaderFillStyle(data.color)
  const rows = useMemo(
    () =>
      entries.map((entry) => {
        const period = entry.period > 0 ? entry.period : 30
        const secondsLeft = period - (Math.floor(now / 1000) % period)
        return { entry, period, secondsLeft }
      }),
    [entries, now]
  )

  return (
    <div className={`term-node authenticator-node${selected ? ' selected' : ''}`} data-easter-surface="authenticator" style={{ borderTopColor: data.color }}>
      <NodeResizer minWidth={260} minHeight={160} isVisible={selected} color={data.color} />
      <div
        className={`term-node__header ${headerFill.className}${headerFill.filled ? ' term-node__header--filled' : ''}`}
        style={headerFill.style}
      >
        <EditableNodeTitle
          value={(data.title as string) ?? ''}
          onChange={(next) => updateNodeData(id, { title: next })}
          emptyLabel={vocab('Authenticator')}
          title={vocab('Click to rename')}
          ariaLabel={vocab('Authenticator node name')}
          rejectEmpty={false}
        />
        <span className="term-node__spacer" />
        <button className="term-node__close" title={vocab('Refresh the list')} onClick={() => void load()}>
          ⟳
        </button>
        <button
          className="term-node__close"
          title={vocab('Close')}
          onClick={() => void deleteElements({ nodes: [{ id }] })}
        >
          ×
        </button>
      </div>

      <div className="authenticator-node__body nodrag nowheel">
        {loadError ? (
          <p className="authenticator-node__empty" role="alert">
            {vocab(loadError)}
          </p>
        ) : rows.length === 0 && vaultRows.length === 0 ? (
          <p className="authenticator-node__empty">
            {vaultNote
              ? vocab(vaultNote)
              : vocab('No generators yet. Add one in Settings under Authenticator, or add a credential with a TOTP secret to this project’s password manager.')}
          </p>
        ) : (
          <ul className="authenticator-node__list">
            {rows.map(({ entry, period, secondsLeft }) => {
              const code = codes[entry.id]?.code
              return (
                <li key={entry.id} className="authenticator-node__row">
                  <div className="authenticator-node__who">
                    <span className="authenticator-node__issuer">{entry.issuer || vocab('Unnamed')}</span>
                    <span className="authenticator-node__account">{entry.account}</span>
                  </div>
                  <button
                    className="authenticator-node__code"
                    // The code IS the button: it is the one thing anybody wants from this row, and
                    // a separate copy icon beside it is a smaller target for the same action.
                    title={vocab(code ? 'Copy this code' : 'Waiting for a code')}
                    disabled={!code}
                    onClick={() => code && void copy(entry.id, code)}
                  >
                    {copied === entry.id ? vocab('Copied') : (code ?? '••••••')}
                  </button>
                  {/* Seconds as TEXT beside the bar: a bar alone is colour and length only, which
                      is unreadable to somebody who cannot see it and ambiguous to everybody at a
                      glance. */}
                  <span
                    className="authenticator-node__countdown"
                    title={`${vocab('New code in')} ${secondsLeft}s`}
                    aria-label={`${vocab('New code in')} ${secondsLeft} ${vocab('seconds')}`}
                  >
                    <span
                      className="authenticator-node__countdown-bar"
                      style={{ width: `${Math.round((secondsLeft / period) * 100)}%` }}
                    />
                    <span className="authenticator-node__countdown-text">{secondsLeft}s</span>
                  </span>
                </li>
              )
            })}
            {vaultRows.map((row) => (
              <li key={`${row.managerId}/${row.credentialId}`} className="authenticator-node__row">
                <div className="authenticator-node__who">
                  <span className="authenticator-node__issuer">{row.label}</span>
                  {/* Named by its manager, so two credentials called "work" in different managers
                      are still tellable apart at a glance. */}
                  <span className="authenticator-node__account">{row.managerName}</span>
                </div>
                <button
                  className="authenticator-node__code"
                  title={vocab('Copy this code')}
                  onClick={() => void copy(`${row.managerId}/${row.credentialId}`, row.code.code)}
                >
                  {copied === `${row.managerId}/${row.credentialId}` ? vocab('Copied') : row.code.code}
                </button>
                <span
                  className="authenticator-node__countdown"
                  title={`${vocab('New code in')} ${vaultSecondsLeft(row.code, now)}s`}
                  aria-label={`${vocab('New code in')} ${vaultSecondsLeft(row.code, now)} ${vocab('seconds')}`}
                >
                  <span
                    className="authenticator-node__countdown-bar"
                    style={{ width: `${Math.round((vaultSecondsLeft(row.code, now) / row.code.period) * 100)}%` }}
                  />
                  <span className="authenticator-node__countdown-text">{vaultSecondsLeft(row.code, now)}s</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* Shown beside real rows too: a locked vault while the authenticator store has entries is
            exactly the case where an unexplained absence would look like a defect. */}
        {vaultNote && (rows.length > 0 || vaultRows.length > 0) && (
          <p className="authenticator-node__empty">{vocab(vaultNote)}</p>
        )}
      </div>
    </div>
  )
}
