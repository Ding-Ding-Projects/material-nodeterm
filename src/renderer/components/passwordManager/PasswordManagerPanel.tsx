// The per-project password manager (shared/password-manager.ts): "projects are still projects...
// but it can have its own password managers, and can even have one password manager per group
// too!!" -- the user's own words. Vaults live at <cwd>/.nodeterm/vault.json, one per project, and
// are encrypted by ONE project password ("'Encryption' is by project password"). This panel is
// the only renderer surface that ever touches a decrypted secret; it never logs, exports, or
// screenshots one, and every reveal is behind an explicit action (docs pending).
//
// LOCAL-ONLY (see shared/types.ts's `PasswordManagerApi` doc comment): reached only through the
// active session's own API, exactly like the file converter and Ollama manager -- a root-mounted
// drawer sits OUTSIDE the project-keyed SessionProvider, so `useActiveSessionApi()` is what makes
// this resolve against the SELECTED project's core rather than the viewer's local one when a
// relay tab is active. The relay allowlist (main/relay-rpc-policy.ts) refuses every
// `password-manager:*` method anyway, so a relay peer gets nothing from this panel either way --
// this is belt-and-braces, not the only guard.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ChangeVaultPasswordInput,
  CreateCredentialInput,
  CredentialCode,
  CredentialSummary,
  PasswordManagerSummary,
  UpdateCredentialSecretInput,
  VaultStatus
} from '@shared/password-manager'
import { E_UNSUPPORTED } from '@shared/rpc'
import type { NodeTerminalApi } from '@shared/types'
import { useProjects } from '../../state/projects'
import { useActiveSessionApi } from '../../session/session'
import { openDestructiveGate } from '../../state/destructiveGate'
import { IconLock, IconUnlock } from '../icons'
import { MaterialSymbol } from '../MaterialSymbol'
import { Button } from '@renderer/ui/Button'
import { Input } from '@renderer/ui/Input'
import { Select } from '@renderer/ui/Select'
import { useVocabularyMapper } from '../../lib/personalVocabulary/useVocabularyText'

export interface PasswordManagerGroupOption {
  id: string
  title: string
}

export interface PasswordManagerPanelProps {
  onClose: () => void
  /** Every group frame currently on the active project's canvas, for the "bind to group" picker.
   *  Read once at open time by the caller (Canvas.tsx) -- a manager binds to a specific frame id,
   *  and a frame renamed while this panel is open is a cosmetic staleness, not a correctness one
   *  (the id, not the title, is what `bindManagerGroup` stores). */
  groups: PasswordManagerGroupOption[]
  /** 'new-credential' jumps straight to the create-credential form for the first manager (making
   *  one first, if none exist yet) once the vault is unlocked -- the canvas pane menu's
   *  "New credential..." row asked for exactly this. 'default' just opens the manager list. */
  initialIntent?: 'default' | 'new-credential'
}

/** Vault state belongs to one (api, projectId) pair. Remounting on either identity change -- via
 *  the `key` prop the caller supplies -- is what a local FileConverterPanel-style scope-key can't
 *  do here, because the vault is genuinely per-project: two projects on the SAME local api must
 *  never show one project's manager list while the lock state was read for another. */
const PANEL_SCOPE_KEYS = new WeakMap<NodeTerminalApi, number>()
let nextPanelScopeKey = 1
function panelScopeKey(api: NodeTerminalApi): number {
  const known = PANEL_SCOPE_KEYS.get(api)
  if (known !== undefined) return known
  const key = nextPanelScopeKey++
  PANEL_SCOPE_KEYS.set(api, key)
  return key
}

function errorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === E_UNSUPPORTED
  ) {
    return `The password manager is not available for this session (${E_UNSUPPORTED}).`
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

/** Grouped for readability, same convention as the built-in authenticator: "123 456". */
function groupDigits(code: string): string {
  const mid = Math.ceil(code.length / 2)
  return `${code.slice(0, mid)} ${code.slice(mid)}`
}

/** The live TOTP code + countdown for one credential, polled while its manager panel is open.
 *  Deliberately per-credential rather than batched: `credentialCode` is scoped by (managerId,
 *  credentialId) and there is no batched sibling to `authenticator.codes(ids)` for this API --
 *  see shared/password-manager.ts.
 *
 *  Whether a credential HAS a TOTP secret is itself part of its encrypted secret half
 *  (`CredentialSummary` -- the metadata every list row gets without unlocking -- carries no
 *  `hasTotp` flag; see shared/password-manager.ts). So this component is mounted unconditionally
 *  for every credential row, and `credentialCode`'s own `no-totp` refusal is what tells it
 *  whether to render a code or "No TOTP" -- there is no other way to know without a reveal. */
function CredentialCodeViewer({
  api,
  projectId,
  managerId,
  credentialId
}: {
  api: NodeTerminalApi
  projectId: string
  managerId: string
  credentialId: string
}): React.JSX.Element {
  const [code, setCode] = useState<CredentialCode | null>(null)
  const [noTotp, setNoTotp] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async (): Promise<void> => {
      try {
        const res = await api.passwordManager.credentialCode(projectId, managerId, credentialId)
        if (cancelled) return
        if (res.ok) {
          setCode(res.code)
          setNoTotp(false)
          setUnavailable(false)
        } else if (res.error === 'no-totp') {
          setCode(null)
          setNoTotp(true)
          setUnavailable(false)
          // No TOTP secret is a stable fact of this credential, not a transient failure --
          // polling again every second would never change the answer, only burn cycles.
          return
        } else {
          setCode(null)
          setNoTotp(false)
          setUnavailable(true)
        }
      } catch {
        if (!cancelled) {
          setCode(null)
          setNoTotp(false)
          setUnavailable(true)
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1000)
    }
    void poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [api, projectId, managerId, credentialId])

  if (noTotp) return <span className="pwm-hint">No TOTP</span>
  if (unavailable || !code) return <span className="pwm-hint">…</span>

  // Real, live, per-second data -- never `Date.now()` at render time, which would drift out of
  // sync with the code core just generated and read wrong the instant a period rolled over.
  const secondsRemaining = Math.max(0, code.periodStart + code.period - Math.floor(Date.now() / 1000))
  const ringDegrees = Math.round(((code.period - secondsRemaining) / code.period) * 360)

  return (
    <span className="pwm-code">
      <span
        className="pwm-code__ring"
        aria-hidden="true"
        style={{ '--md3-ring-deg': `${ringDegrees}deg` } as React.CSSProperties}
      />
      <span className="pwm-code__digits" aria-live="polite">
        {groupDigits(code.code)}
      </span>
      {/* The countdown NEVER relies on the ring's color/motion alone -- it is also literal text,
          both a visible hint and an assertive live region so a screen reader hears the rollover
          without re-reading the whole row every second. */}
      <span className="pwm-hint" aria-hidden="true">
        {secondsRemaining}s · next {groupDigits(code.next)}
      </span>
      <span className="sr-only" aria-live="off">
        New code in {secondsRemaining} seconds
      </span>
    </span>
  )
}

function RevealButton({ onReveal, label }: { onReveal: () => Promise<string | null>; label: string }): React.JSX.Element {
  const [value, setValue] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (value !== null) {
    return (
      <span className="pwm-revealed">
        <code className="pwm-revealed__text">{value}</code>
        <Button variant="default" onClick={() => setValue(null)}>
          Hide
        </Button>
      </span>
    )
  }
  return (
    <Button variant="default"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          const v = await onReveal()
          setValue(v)
        } finally {
          setBusy(false)
        }
      }}
    >
      {label}
    </Button>
  )
}

interface CredentialRowProps {
  api: NodeTerminalApi
  projectId: string
  managerId: string
  credential: CredentialSummary
  onChanged: () => void
  onError: (message: string) => void
}

function CredentialRow({ api, projectId, managerId, credential, onChanged, onError }: CredentialRowProps): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(credential.label)
  const [editingSecret, setEditingSecret] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [savingSecret, setSavingSecret] = useState(false)

  const saveRename = async (): Promise<void> => {
    const next = label.trim()
    if (!next || next === credential.label) {
      setRenaming(false)
      setLabel(credential.label)
      return
    }
    const res = await api.passwordManager.renameCredential(projectId, { managerId, credentialId: credential.id, label: next })
    if (!res.ok) {
      onError(res.error === 'not-found' ? 'That credential no longer exists.' : 'Could not rename that credential.')
      return
    }
    setRenaming(false)
    onChanged()
  }

  const openSecretEditor = async (): Promise<void> => {
    // Editing overwrites, so pre-fill from a real reveal -- an empty box would silently blank the
    // password/TOTP the moment "Save" is pressed without the user having typed anything into it.
    try {
      const res = await api.passwordManager.revealCredential(projectId, managerId, credential.id)
      if (res.ok) {
        setUsername(res.username)
        setPassword(res.password)
        setTotp(res.totpSecretBase32 ?? '')
        setEditingSecret(true)
      } else {
        onError(res.error === 'locked' ? 'The vault locked while this panel was open.' : 'That credential no longer exists.')
      }
    } catch (error) {
      onError(errorMessage(error, 'Could not open that credential for editing.'))
    }
  }

  const saveSecret = async (): Promise<void> => {
    setSavingSecret(true)
    try {
      const input: UpdateCredentialSecretInput = {
        managerId,
        credentialId: credential.id,
        username,
        password,
        totpSecretBase32: totp.trim() ? totp.trim() : null
      }
      const res = await api.passwordManager.updateCredentialSecret(projectId, input)
      if (!res.ok) {
        onError(res.error === 'locked' ? 'The vault locked while this panel was open.' : 'That credential no longer exists.')
        return
      }
      setEditingSecret(false)
      setUsername('')
      setPassword('')
      setTotp('')
      onChanged()
    } catch (error) {
      onError(errorMessage(error, 'Could not save that credential.'))
    } finally {
      setSavingSecret(false)
    }
  }

  const requestRemove = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const opened = openDestructiveGate({
      title: `Delete "${credential.label}"`,
      description:
        'Permanently deletes this credential -- its username, password, and TOTP secret -- from the vault. This cannot be undone.',
      confirmLabel: 'Delete credential',
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: e.currentTarget,
      onConfirm: () => {
        void (async () => {
          try {
            const res = await api.passwordManager.removeCredential(projectId, { managerId, credentialId: credential.id })
            if (!res.ok) {
              onError(res.error === 'not-found' ? 'That credential was already removed.' : 'Could not delete that credential.')
              return
            }
            onChanged()
          } catch (error) {
            onError(errorMessage(error, 'Could not delete that credential.'))
          }
        })()
      }
    })
    if (!opened) onError('Another destructive confirmation is already open. Try again after it closes.')
  }

  return (
    <li className="pwm-credential-row">
      <MaterialSymbol name="vpn_key" size={18} className="pwm-credential-row__icon" aria-hidden="true" />
      <div className="pwm-credential-row__id">
        {renaming ? (
          <Input
            value={label}
            autoFocus
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveRename()
              else if (e.key === 'Escape') {
                setRenaming(false)
                setLabel(credential.label)
              }
            }}
            aria-label="Credential label"
          />
        ) : (
          <span className="pwm-credential-row__label">{credential.label}</span>
        )}
      </div>

      {editingSecret ? (
        <div className="pwm-secret-editor">
          <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} aria-label="Username" />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-label="Password"
          />
          <Input
            placeholder="TOTP secret (base32, optional)"
            value={totp}
            onChange={(e) => setTotp(e.target.value)}
            aria-label="TOTP secret"
          />
          <div className="pwm-row-actions">
            <Button variant="primary" disabled={savingSecret} onClick={() => void saveSecret()}>
              Save
            </Button>
            <Button variant="default" onClick={() => setEditingSecret(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="pwm-credential-row__code">
            <CredentialCodeViewer api={api} projectId={projectId} managerId={managerId} credentialId={credential.id} />
          </div>
          <div className="pwm-row-actions">
            <RevealButton
              label="Reveal"
              onReveal={async () => {
                try {
                  const res = await api.passwordManager.revealCredential(projectId, managerId, credential.id)
                  if (!res.ok) {
                    onError(res.error === 'locked' ? 'The vault locked while this panel was open.' : 'That credential no longer exists.')
                    return null
                  }
                  return `${res.username} · ${res.password}`
                } catch (error) {
                  onError(errorMessage(error, 'Could not reveal that credential.'))
                  return null
                }
              }}
            />
            {!renaming && (
              <Button variant="default" onClick={() => setRenaming(true)}>
                Rename
              </Button>
            )}
            {renaming && (
              <Button variant="default" onClick={() => void saveRename()}>
                Save
              </Button>
            )}
            <Button variant="default" onClick={() => void openSecretEditor()}>
              Edit
            </Button>
            <Button variant="default" danger onClick={requestRemove}>
              Delete
            </Button>
          </div>
        </>
      )}
    </li>
  )
}

function AddCredentialForm({
  api,
  projectId,
  managerId,
  onAdded,
  onError,
  autoFocus
}: {
  api: NodeTerminalApi
  projectId: string
  managerId: string
  onAdded: (created: CredentialSummary) => void
  onError: (message: string) => void
  autoFocus?: boolean
}): React.JSX.Element {
  const [label, setLabel] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const trimmedLabel = label.trim()
    if (!trimmedLabel) return
    setBusy(true)
    try {
      const input: CreateCredentialInput = {
        managerId,
        label: trimmedLabel,
        username,
        password,
        totpSecretBase32: totp.trim() || undefined
      }
      const res = await api.passwordManager.createCredential(projectId, input)
      if (!res.ok) {
        onError(
          res.error === 'locked'
            ? 'The vault locked while this panel was open.'
            : res.error === 'not-found'
              ? 'That manager no longer exists.'
              : 'Could not create that credential.'
        )
        return
      }
      setLabel('')
      setUsername('')
      setPassword('')
      setTotp('')
      onAdded(res.credential)
    } catch (error) {
      onError(errorMessage(error, 'Could not create that credential.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pwm-add-credential">
      <Input
        placeholder="Label (e.g. GitHub)"
        value={label}
        autoFocus={autoFocus}
        onChange={(e) => setLabel(e.target.value)}
        aria-label="New credential label"
      />
      <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} aria-label="Username" />
      <Input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-label="Password"
      />
      <Input
        placeholder="TOTP secret (base32, optional)"
        value={totp}
        onChange={(e) => setTotp(e.target.value)}
        aria-label="TOTP secret"
      />
      <Button variant="primary" size="medium" disabled={busy || !label.trim()} onClick={() => void submit()}>
        Add credential
      </Button>
    </div>
  )
}

function ManagerCard({
  api,
  projectId,
  manager,
  groups,
  autoAddCredential,
  onChanged,
  onError
}: {
  api: NodeTerminalApi
  projectId: string
  manager: PasswordManagerSummary
  groups: PasswordManagerGroupOption[]
  autoAddCredential: boolean
  onChanged: () => void
  onError: (message: string) => void
}): React.JSX.Element {
  // The credential ROWS, fetched from the vault rather than echoed from whatever this session
  // happened to touch. Before `listCredentials` existed, a credential created in an earlier
  // session showed up only inside the manager's COUNT: "2 credentials" above a list showing none
  // of them, with no way to reach them. That was documented as a v1 gap and it read, correctly, as
  // the feature being broken.
  //
  // No key is required to ask: labels, ids and timestamps are cleartext in the vault file, exactly
  // as manager names and counts already are in `status()`. Only the secret half needs unlocking.
  const [credentials, setCredentials] = useState<CredentialSummary[]>([])
  const [expanded, setExpanded] = useState(autoAddCredential)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(manager.name)
  const [showAdd, setShowAdd] = useState(autoAddCredential)
  const [listError, setListError] = useState<string | null>(null)

  // Re-read whenever the manager's own credential COUNT changes, which is what every mutation
  // moves: create, remove, and a manager swapped under the same card. Keying on the count rather
  // than a manual refresh flag means a row added elsewhere still lands here.
  useEffect(() => {
    let alive = true
    void api.passwordManager
      .listCredentials(projectId, manager.id)
      .then((res) => {
        if (!alive) return
        if (res.ok) {
          setCredentials(res.credentials)
          setListError(null)
          return
        }
        // A manager that no longer exists and a vault that was never created are different
        // stories, and neither of them is "this manager is empty": showing an empty list for
        // either would repeat the exact defect this call was added to fix.
        setCredentials([])
        setListError(
          res.error === 'not-found'
            ? 'This manager no longer exists. Refresh the panel.'
            : res.error === 'uninitialized'
              ? 'Set a project password first.'
              : 'Credentials cannot be listed for this project.'
        )
      })
      .catch(() => {
        if (!alive) return
        setCredentials([])
        setListError('Could not read this project’s credentials.')
      })
    return () => {
      alive = false
    }
  }, [api, projectId, manager.id, manager.credentialCount])

  const requestDelete = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const opened = openDestructiveGate({
      title: `Delete manager "${manager.name}"`,
      description: `Permanently deletes this manager and all ${manager.credentialCount} credential${manager.credentialCount === 1 ? '' : 's'} inside it. This cannot be undone.`,
      confirmLabel: 'Delete manager',
      anchor: { x: rect.left, y: rect.bottom },
      restoreFocusEl: e.currentTarget,
      onConfirm: () => {
        void (async () => {
          try {
            const res = await api.passwordManager.deleteManager(projectId, manager.id)
            if (!res.ok) {
              onError(res.error === 'not-found' ? 'That manager was already deleted.' : 'Could not delete that manager.')
              return
            }
            onChanged()
          } catch (error) {
            onError(errorMessage(error, 'Could not delete that manager.'))
          }
        })()
      }
    })
    if (!opened) onError('Another destructive confirmation is already open. Try again after it closes.')
  }

  const saveRename = async (): Promise<void> => {
    const next = name.trim()
    if (!next || next === manager.name) {
      setRenaming(false)
      setName(manager.name)
      return
    }
    const res = await api.passwordManager.renameManager(projectId, { id: manager.id, name: next })
    if (!res.ok) {
      onError('Could not rename that manager.')
      return
    }
    setRenaming(false)
    onChanged()
  }

  const rebind = async (groupId: string): Promise<void> => {
    const res = await api.passwordManager.bindManagerGroup(projectId, { id: manager.id, groupId: groupId || undefined })
    if (!res.ok) {
      onError('Could not bind that manager.')
      return
    }
    onChanged()
  }

  const boundGroupTitle = manager.groupId ? groups.find((g) => g.id === manager.groupId)?.title : undefined

  return (
    <li className="pwm-manager-card">
      <div className="pwm-manager-card__head">
        <Button size="small" vocabularyMode="factual" className="pwm-manager-card__toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <MaterialSymbol name={expanded ? 'lock_open' : 'vpn_key'} size={18} aria-hidden="true" />
          {renaming ? (
            <Input
              value={name}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveRename()
                else if (e.key === 'Escape') {
                  setRenaming(false)
                  setName(manager.name)
                }
              }}
              aria-label="Manager name"
            />
          ) : (
            <span className="pwm-manager-card__name">{manager.name}</span>
          )}
          <span className="pwm-hint">
            {manager.credentialCount} credential{manager.credentialCount === 1 ? '' : 's'}
            {boundGroupTitle ? ` · bound to "${boundGroupTitle}"` : ''}
          </span>
        </Button>
        <div className="pwm-row-actions">
          {!renaming && (
            <Button variant="default"
              onClick={(e) => {
                e.stopPropagation()
                setRenaming(true)
              }}
            >
              Rename
            </Button>
          )}
          <Select
            className="pwm-select"
            aria-label={`Bind "${manager.name}" to a group`}
            value={manager.groupId ?? ''}
            onChange={(e) => void rebind(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          >
            <option value="">Project-scoped (no group)</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
          <Button variant="default" danger
            onClick={(e) => {
              e.stopPropagation()
              requestDelete(e)
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="pwm-manager-card__body">
          <ul className="pwm-credential-list">
            {credentials.map((c) => (
              <CredentialRow
                key={c.id}
                api={api}
                projectId={projectId}
                managerId={manager.id}
                credential={c}
                onChanged={() => onChanged()}
                onError={onError}
              />
            ))}
            {listError && (
              <li className="pwm-hint pwm-manager-card__stale-note" role="alert">
                {listError}
              </li>
            )}
            {!listError && credentials.length === 0 && (
              <li className="pwm-hint pwm-manager-card__stale-note">No credentials yet.</li>
            )}
          </ul>
          {showAdd ? (
            <AddCredentialForm
              api={api}
              projectId={projectId}
              managerId={manager.id}
              autoFocus={autoAddCredential}
              onAdded={(added) => {
                if (added) setCredentials((prev) => [...prev, added])
                setShowAdd(false)
                onChanged()
              }}
              onError={onError}
            />
          ) : (
            <Button variant="default" onClick={() => setShowAdd(true)}>
              + Add credential
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function CreateVaultForm({ api, projectId, onCreated }: { api: NodeTerminalApi; projectId: string; onCreated: () => void }): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError(null)
    if (!password) {
      setError('Enter a password.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const res = await api.passwordManager.createVault(projectId, password)
      if (!res.ok) {
        setError(
          res.error === 'already-initialized'
            ? 'This project already has a password manager set up.'
            : 'This project has no local folder to keep a vault in, so a password manager cannot be set up for it.'
        )
        return
      }
      onCreated()
    } catch (error) {
      setError(errorMessage(error, 'Could not set up the password manager.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pwm-empty">
      <MaterialSymbol name="lock" size={28} aria-hidden="true" />
      <h3>Set a project password</h3>
      <p className="pwm-hint">
        This project has no password manager yet. Set ONE password for it -- every credential you store, and its TOTP secret,
        is encrypted with a key derived from this password. There is no recovery if it is lost.
      </p>
      <div className="pwm-vault-form">
        <Input
          type="password"
          placeholder="Project password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Project password"
        />
        <Input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          aria-label="Confirm project password"
        />
        {error && (
          <div className="pwm-warn" role="alert">
            {error}
          </div>
        )}
        <Button variant="primary" size="medium" disabled={busy || !password} onClick={() => void submit()}>
          Create password manager
        </Button>
      </div>
    </section>
  )
}

function UnlockForm({ api, projectId, onUnlocked }: { api: NodeTerminalApi; projectId: string; onUnlocked: () => void }): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const res = await api.passwordManager.unlock(projectId, password)
      if (!res.ok) {
        // Deliberately the SAME message for "wrong password" and any other refusal the core
        // reports here (core/password-manager/vault.ts conflates a bad password with a tampered
        // vault file on purpose -- an attacker who can edit vault.json must not learn WHICH). Do
        // not special-case `res.error` into a more specific sentence; that would leak the
        // distinction back through this UI even though the wire result already refuses to.
        setError('Wrong password, or this vault could not be verified.')
        return
      }
      onUnlocked()
    } catch (error) {
      setError(errorMessage(error, 'Could not unlock the password manager.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="pwm-empty">
      <MaterialSymbol name="lock" size={28} aria-hidden="true" />
      <h3>Locked</h3>
      <p className="pwm-hint">Enter this project's password to unlock its credentials.</p>
      <div className="pwm-vault-form">
        <Input
          type="password"
          placeholder="Project password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          aria-label="Project password"
        />
        {error && (
          <div className="pwm-warn" role="alert">
            {error}
          </div>
        )}
        <Button variant="primary" size="medium" disabled={busy || !password} onClick={() => void submit()}>
          Unlock
        </Button>
      </div>
    </section>
  )
}

function ChangePasswordForm({ api, projectId, onDone }: { api: NodeTerminalApi; projectId: string; onDone: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!open) {
    return (
      <Button variant="default" onClick={() => setOpen(true)}>
        Change project password…
      </Button>
    )
  }

  const submit = async (): Promise<void> => {
    setError(null)
    if (next !== confirm) {
      setError('New passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const input: ChangeVaultPasswordInput = { currentPassword: current, newPassword: next }
      const res = await api.passwordManager.changePassword(projectId, input)
      if (!res.ok) {
        setError(res.error === 'wrong-password' ? 'Current password is wrong.' : 'Could not change the password.')
        return
      }
      setOpen(false)
      setCurrent('')
      setNext('')
      setConfirm('')
      onDone()
    } catch (error) {
      setError(errorMessage(error, 'Could not change the password.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pwm-vault-form pwm-vault-form--inline">
      <Input
        type="password"
        placeholder="Current password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        aria-label="Current password"
      />
      <Input
        type="password"
        placeholder="New password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        aria-label="New password"
      />
      <Input
        type="password"
        placeholder="Confirm new password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        aria-label="Confirm new password"
      />
      {error && (
        <div className="pwm-warn" role="alert">
          {error}
        </div>
      )}
      <div className="pwm-row-actions">
        <Button variant="primary" disabled={busy || !current || !next} onClick={() => void submit()}>
          Save
        </Button>
        <Button variant="default" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function CreateManagerForm({
  api,
  projectId,
  groups,
  onCreated,
  autoFocus
}: {
  api: NodeTerminalApi
  projectId: string
  groups: PasswordManagerGroupOption[]
  onCreated: () => void
  autoFocus?: boolean
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.passwordManager.createManager(projectId, { name: trimmed, groupId: groupId || undefined })
      if (!res.ok) {
        setError(res.error || 'Could not create that manager.')
        return
      }
      setName('')
      setGroupId('')
      onCreated()
    } catch (error) {
      setError(errorMessage(error, 'Could not create that manager.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pwm-add-manager">
      <Input
        placeholder="Manager name (e.g. Work accounts)"
        value={name}
        autoFocus={autoFocus}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        aria-label="New manager name"
      />
      <Select className="pwm-select" value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Bind to group">
        <option value="">Project-scoped (no group)</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.title}
          </option>
        ))}
      </Select>
      {error && (
        <div className="pwm-warn" role="alert">
          {error}
        </div>
      )}
      <Button variant="primary" size="medium" disabled={busy || !name.trim()} onClick={() => void submit()}>
        Create manager
      </Button>
    </div>
  )
}

interface ManagerSection {
  key: string
  title: string
  managers: PasswordManagerSummary[]
}

/** Split the flat manager list into one section per bound group. Pure so the ordering and the
 *  "bound to a group that no longer exists" case can be reasoned about (and tested) without a DOM. */
export function groupManagerSections(
  managers: PasswordManagerSummary[],
  groups: PasswordManagerGroupOption[]
): ManagerSection[] {
  const sections: ManagerSection[] = []
  const push = (key: string, title: string, list: PasswordManagerSummary[]): void => {
    if (list.length > 0) sections.push({ key, title, managers: list })
  }
  push(
    'project',
    'Project-scoped',
    managers.filter((m) => !m.groupId)
  )
  for (const g of groups) {
    push(
      `group:${g.id}`,
      g.title,
      managers.filter((m) => m.groupId === g.id)
    )
  }
  const known = new Set(groups.map((g) => g.id))
  push(
    'orphaned',
    'Bound to a group that no longer exists',
    managers.filter((m) => m.groupId && !known.has(m.groupId))
  )
  return sections
}

function ManagerGroupSection({
  title,
  managers,
  api,
  projectId,
  groups,
  autoAddManagerId,
  onChanged,
  onError
}: {
  title: string
  managers: PasswordManagerSummary[]
  api: NodeTerminalApi
  projectId: string
  groups: PasswordManagerGroupOption[]
  autoAddManagerId: string | null
  onChanged: () => void
  onError: (message: string) => void
}): React.JSX.Element {
  // A section holding the manager the "New credential..." intent is about must never start
  // collapsed, or that jump would land on a hidden form.
  const [collapsed, setCollapsed] = useState(false)
  const holdsAutoAdd = managers.some((m) => m.id === autoAddManagerId)
  const open = !collapsed || holdsAutoAdd
  const count = managers.reduce((n, m) => n + m.credentialCount, 0)

  return (
    <section className="pwm-manager-group">
      <Button size="small" vocabularyMode="factual"
        className="pwm-manager-group__head"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={open}
        title={open ? `Collapse "${title}"` : `Expand "${title}"`}
      >
        <MaterialSymbol name={open ? 'arrow_drop_down' : 'chevron_right'} size={18} aria-hidden="true" />
        <span className="pwm-manager-group__title">{title}</span>
        <span className="pwm-hint">
          {managers.length} manager{managers.length === 1 ? '' : 's'} · {count} credential{count === 1 ? '' : 's'}
        </span>
      </Button>
      {open && (
        <ul className="pwm-manager-list">
          {managers.map((m) => (
            <ManagerCard
              key={m.id}
              api={api}
              projectId={projectId}
              manager={m}
              groups={groups}
              autoAddCredential={m.id === autoAddManagerId}
              onChanged={onChanged}
              onError={onError}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function UnlockedView({
  api,
  projectId,
  groups,
  status,
  initialIntent,
  refresh
}: {
  api: NodeTerminalApi
  projectId: string
  groups: PasswordManagerGroupOption[]
  status: VaultStatus
  initialIntent: 'default' | 'new-credential'
  refresh: () => void
}): React.JSX.Element {
  const [error, setError] = useState<string | null>(null)
  // 'new-credential' consumed once: the pane menu's "New credential..." row jumps here, but a
  // later manual re-open of the panel (or a manager create/refresh cycle) must not keep
  // re-triggering it -- this ref makes the auto-expand a ONE-SHOT rather than a sticky mode.
  const consumedIntent = useRef(false)

  const onError = (message: string): void => setError(message)
  const onChanged = (): void => {
    setError(null)
    refresh()
  }

  const wantsAutoAdd = initialIntent === 'new-credential' && !consumedIntent.current
  if (wantsAutoAdd) consumedIntent.current = true
  const autoAddManagerId = wantsAutoAdd ? (status.managers[0]?.id ?? null) : null

  // Managers are listed under the group they are bound to, so a canvas with several group frames
  // reads as several sections rather than one long list. Order follows the `groups` array (the
  // canvas's own order), with project-scoped managers first and any manager bound to a group that
  // no longer exists kept visible under its own heading rather than silently dropped.
  const sections = groupManagerSections(status.managers, groups)

  return (
    <section className="pwm-managers">
      <div className="pwm-managers__head">
        <h3>Password managers</h3>
        <ChangePasswordForm api={api} projectId={projectId} onDone={onChanged} />
      </div>
      {error && (
        <div className="pwm-warn" role="alert">
          {error}
        </div>
      )}
      {status.managers.length === 0 ? (
        <p className="pwm-hint">No managers yet. Create one to start storing credentials.</p>
      ) : (
        sections.map((section) => (
          <ManagerGroupSection
            key={section.key}
            title={section.title}
            managers={section.managers}
            api={api}
            projectId={projectId}
            groups={groups}
            autoAddManagerId={autoAddManagerId}
            onChanged={onChanged}
            onError={onError}
          />
        ))
      )}
      <CreateManagerForm
        api={api}
        projectId={projectId}
        groups={groups}
        onCreated={onChanged}
        autoFocus={wantsAutoAdd && status.managers.length === 0}
      />
    </section>
  )
}

function PasswordManagerPanelInner({
  api,
  projectId,
  groups,
  initialIntent,
  onClose
}: {
  api: NodeTerminalApi
  projectId: string
  groups: PasswordManagerGroupOption[]
  initialIntent: 'default' | 'new-credential'
  onClose: () => void
}): React.JSX.Element {
  const vocab = useVocabularyMapper()
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await api.passwordManager.status(projectId)
      setStatus(s)
      setError(null)
    } catch (error) {
      setError(errorMessage(error, 'Could not read the password manager for this project.'))
    }
  }, [api, projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Closing over the current keyboard event target -- Escape should close this panel like every
  // other drawer, but only while nothing else on the shared dialog stack (the destructive gate,
  // the two-key export gate) is above it. Those already stopPropagation on their own Escape
  // handling, so a bare window listener here is safe: it never fires while one of them is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lock = async (): Promise<void> => {
    await api.passwordManager.lock(projectId)
    void refresh()
  }

  let body: React.JSX.Element
  if (error) {
    body = (
      <section className="pwm-empty" role="alert">
        <MaterialSymbol name="warning" size={28} aria-hidden="true" />
        <h3>Could not load</h3>
        <p className="pwm-hint">{error}</p>
        <Button variant="default" size="medium" onClick={() => void refresh()}>
          Retry
        </Button>
      </section>
    )
  } else if (!status) {
    body = <section className="pwm-empty">Loading…</section>
  } else if (status.state.kind === 'unsupported') {
    body = (
      <section className="pwm-empty">
        <MaterialSymbol name="lock" size={28} aria-hidden="true" />
        <h3>Not available for this project</h3>
        <p className="pwm-hint">
          This tab is a live connection to a project on another machine, so its password manager lives there too -
          open it on the machine that owns the project.
        </p>
      </section>
    )
  } else if (status.state.kind === 'uninitialized') {
    body = <CreateVaultForm api={api} projectId={projectId} onCreated={refresh} />
  } else if (status.state.kind === 'locked') {
    body = <UnlockForm api={api} projectId={projectId} onUnlocked={refresh} />
  } else {
    body = <UnlockedView api={api} projectId={projectId} groups={groups} status={status} initialIntent={initialIntent} refresh={refresh} />
  }

  const unlocked = status?.state.kind === 'unlocked'

  return createPortal(
    <div className="drawer-overlay md3-passwordmanager" onClick={onClose}>
      <aside className="drawer passwordmanager" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={vocab('Password manager')}>
        <div className="drawer__head">
          <h2 className="pwm-head-title">
            {unlocked ? <IconUnlock /> : <IconLock />}
            <span>Password manager</span>
          </h2>
          <div className="pwm-row-actions">
            {unlocked && (
              <Button variant="default" onClick={() => void lock()}>
                Lock
              </Button>
            )}
            <Button size="small" vocabularyMode="factual" className="drawer__close" onClick={onClose} aria-label="Close">
              <MaterialSymbol name="close" size={18} />
            </Button>
          </div>
        </div>
        <div className="drawer__body pwm-body">{body}</div>
      </aside>
    </div>,
    document.body
  )
}

/**
 * Public entry point. Keys its inner tree on `(api identity, projectId)` so switching the active
 * project -- or the active session an already-open panel is scoped to -- fully remounts the vault
 * state rather than showing project A's manager list while a status read for project B is still
 * settling. `panelScopeKey` gives a stable number per api identity (same convention as the file
 * converter / Ollama manager panels); `projectId` is already stable.
 */
export function PasswordManagerPanel({ onClose, groups, initialIntent = 'default' }: PasswordManagerPanelProps): React.JSX.Element | null {
  const api = useActiveSessionApi()
  const projectId = useProjects((s) => s.activeProjectId)
  if (!projectId) return null
  return (
    <PasswordManagerPanelInner
      key={`${panelScopeKey(api)}:${projectId}`}
      api={api}
      projectId={projectId}
      groups={groups}
      initialIntent={initialIntent}
      onClose={onClose}
    />
  )
}
