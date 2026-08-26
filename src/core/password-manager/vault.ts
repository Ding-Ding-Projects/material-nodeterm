// Pure document operations over a VaultFileV1 — the container model plus the crypto boundary.
// Nothing here performs I/O; every function takes a document (and, where a real secret is
// touched, an already-derived key) and returns a new document. That split is what makes the
// "locked state" tractable: a caller with no key can still rename a manager, delete a credential,
// or release a group binding (all of it cleartext metadata), and a caller with the WRONG key finds
// out from a thrown VaultCryptoError before anything is written — see vault-store.ts's `mutate`
// for how that throw is turned into "no bytes published, no partial write" rather than a
// half-applied document.

import { randomUUID } from 'crypto'
import { base32Decode, totp, totpCounterForTime, type OtpAlgorithm } from '../toylocks/totp'
import { DEFAULT_KDF_PARAMS, VaultCryptoError, decryptPayload, deriveVaultKey, encryptPayload, newSalt } from './crypto'
import type {
  CredentialCode,
  CredentialRecord,
  CredentialSecret,
  CredentialSummary,
  EncryptedPayload,
  PasswordManagerRecord,
  VaultFileV1,
  VaultKdfParams,
  VaultStatus
} from '../../shared/password-manager'

const VERIFIER_PLAINTEXT = { v: 1, check: 'nodeterm-password-manager-vault' } as const

// ---- validation --------------------------------------------------------------------------

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return p.v === 1 && typeof p.iv === 'string' && typeof p.ciphertext === 'string' && typeof p.tag === 'string'
}

function isCredentialRecord(value: unknown): value is CredentialRecord {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    UUID_V4_RE.test(c.id) &&
    typeof c.label === 'string' &&
    typeof c.createdAt === 'number' &&
    typeof c.updatedAt === 'number' &&
    isEncryptedPayload(c.secret)
  )
}

function isManagerRecord(value: unknown): value is PasswordManagerRecord {
  if (!value || typeof value !== 'object') return false
  const m = value as Record<string, unknown>
  if (
    typeof m.id !== 'string' ||
    !UUID_V4_RE.test(m.id) ||
    typeof m.name !== 'string' ||
    typeof m.createdAt !== 'number' ||
    typeof m.updatedAt !== 'number' ||
    (m.groupId !== undefined && typeof m.groupId !== 'string') ||
    !Array.isArray(m.credentials)
  ) {
    return false
  }
  if (!m.credentials.every(isCredentialRecord)) return false
  const ids = new Set((m.credentials as CredentialRecord[]).map((c) => c.id))
  return ids.size === m.credentials.length
}

/** True only for a well-formed, internally-consistent (no duplicate ids at either level)
 *  document. Used by vault-store.ts on every load — a corrupt/malformed file must reject rather
 *  than silently read as "no vault", exactly the rule secure-store.ts already applies to its own
 *  sealed-entry list. */
export function isValidVaultFile(value: unknown): value is VaultFileV1 {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (v.version !== 1) return false
  if (typeof v.salt !== 'string') return false
  if (!isEncryptedPayload(v.verifier)) return false
  const kdf = v.kdf as Partial<VaultKdfParams> | undefined
  if (
    !kdf ||
    typeof kdf.N !== 'number' ||
    typeof kdf.r !== 'number' ||
    typeof kdf.p !== 'number' ||
    typeof kdf.keylen !== 'number'
  ) {
    return false
  }
  if (!Array.isArray(v.managers) || !v.managers.every(isManagerRecord)) return false
  const ids = new Set((v.managers as PasswordManagerRecord[]).map((m) => m.id))
  return ids.size === v.managers.length
}

export function assertValidVaultFile(value: unknown): asserts value is VaultFileV1 {
  if (!isValidVaultFile(value)) {
    throw new Error('Password manager vault has an unsupported or malformed document')
  }
}

// ---- vault lifecycle ----------------------------------------------------------------------

/** A brand-new, empty vault for a project that has never had a password set. Fresh random salt —
 *  see crypto.ts's `deriveVaultKey` doc comment for why the salt travels alongside the ciphertext
 *  rather than being secret itself. */
export function createVault(password: string, params: VaultKdfParams = DEFAULT_KDF_PARAMS): VaultFileV1 {
  const salt = newSalt()
  const key = deriveVaultKey(password, salt.toString('base64'), params)
  return {
    version: 1,
    kdf: params,
    salt: salt.toString('base64'),
    verifier: encryptPayload(key, VERIFIER_PLAINTEXT),
    managers: []
  }
}

/**
 * Derive the key `password` implies and check it against the vault's canary. Pure — never
 * mutates `vault`, never touches a real credential's ciphertext, and a WRONG password fails
 * cleanly: `null`, nothing thrown, nothing written (there is nothing to write; this function
 * performs no I/O at all). Deliberately does not distinguish "wrong password" from "the verifier
 * itself is corrupt" — see crypto.ts's `decryptPayload` for why that distinction cannot be made
 * safely.
 */
export function unlockVault(vault: VaultFileV1, password: string): Buffer | null {
  const key = deriveVaultKey(password, vault.salt, vault.kdf)
  try {
    decryptPayload<typeof VERIFIER_PLAINTEXT>(key, vault.verifier)
    return key
  } catch (error) {
    if (error instanceof VaultCryptoError) return null
    throw error
  }
}

/** The one path that touches EVERY credential's ciphertext on purpose: re-encrypt the whole vault
 *  under a freshly derived key (new salt) after the password itself changes. `currentKey` must be
 *  the key `unlockVault` returned for the CURRENT password — a wrong one throws VaultCryptoError
 *  the moment the first credential fails to decrypt, before any output object is even assembled
 *  (this function builds its result by mapping over copies; nothing is written back into the
 *  `vault` argument on any path, so a thrown error here leaves the caller's document untouched). */
export function changeVaultPassword(
  vault: VaultFileV1,
  currentKey: Buffer,
  newPassword: string,
  params: VaultKdfParams = vault.kdf
): VaultFileV1 {
  const salt = newSalt()
  const newKey = deriveVaultKey(newPassword, salt.toString('base64'), params)
  const managers = vault.managers.map((m) => ({
    ...m,
    credentials: m.credentials.map((c) => {
      const secret = decryptPayload<CredentialSecret>(currentKey, c.secret)
      return { ...c, secret: encryptPayload(newKey, secret), updatedAt: Date.now() }
    })
  }))
  return {
    ...vault,
    kdf: params,
    salt: salt.toString('base64'),
    verifier: encryptPayload(newKey, VERIFIER_PLAINTEXT),
    managers
  }
}

/** Project onto what a caller who may or may not hold the key is allowed to see: every manager's
 *  non-secret metadata plus a credential COUNT, never the credentials themselves. */
export function statusOf(vault: VaultFileV1 | undefined, unlocked: boolean): VaultStatus {
  if (!vault) return { state: { kind: 'uninitialized' }, managers: [] }
  return {
    state: unlocked ? { kind: 'unlocked' } : { kind: 'locked' },
    managers: vault.managers.map(({ credentials, ...meta }) => ({
      ...meta,
      credentialCount: credentials.length
    }))
  }
}

function findManager(vault: VaultFileV1, id: string): PasswordManagerRecord | undefined {
  return vault.managers.find((m) => m.id === id)
}

// ---- managers (cleartext metadata — no key required) ---------------------------------------

export function createManager(
  vault: VaultFileV1,
  input: { name: string; groupId?: string }
): { vault: VaultFileV1; manager: PasswordManagerRecord } {
  const now = Date.now()
  const manager: PasswordManagerRecord = {
    id: randomUUID(),
    name: input.name.trim() || 'Password manager',
    groupId: input.groupId,
    createdAt: now,
    updatedAt: now,
    credentials: []
  }
  return { vault: { ...vault, managers: [...vault.managers, manager] }, manager }
}

export function renameManager(vault: VaultFileV1, id: string, name: string): VaultFileV1 | null {
  if (!findManager(vault, id)) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  return {
    ...vault,
    managers: vault.managers.map((m) => (m.id === id ? { ...m, name: trimmed, updatedAt: Date.now() } : m))
  }
}

export function bindManagerToGroup(
  vault: VaultFileV1,
  id: string,
  groupId: string | undefined
): VaultFileV1 | null {
  if (!findManager(vault, id)) return null
  return {
    ...vault,
    managers: vault.managers.map((m) => (m.id === id ? { ...m, groupId, updatedAt: Date.now() } : m))
  }
}

/**
 * Every path that can drop a bound canvas group frame routes here — the core-side counterpart of
 * Canvas.tsx's `releaseWorktreeBinding` for `GroupWorktree` (CLAUDE.md's Worktrees section). Same
 * chosen precedent, applied to a different kind of binding: releasing it NEVER destroys the bound
 * resource, only its SCOPE. A worktree binding release leaves the worktree itself on disk as a
 * re-adoptable orphan; a password-manager binding release here leaves the manager — and every one
 * of its credentials — exactly as it was, just no longer scoped to a group id that no longer
 * refers to anything. There is no "delete this manager because its group went away" path anywhere
 * in this module; deleting a manager is always its own separate, explicit action (`deleteManager`).
 *
 * Unlike a worktree, a manager binding owns no external resource (no directory to prune, no git
 * registration to clean up) — clearing `groupId` is the WHOLE of what this owes the world.
 */
export function releaseGroupBinding(
  vault: VaultFileV1,
  groupId: string
): { vault: VaultFileV1; releasedManagerIds: string[] } {
  const releasedManagerIds: string[] = []
  const managers = vault.managers.map((m) => {
    if (m.groupId !== groupId) return m
    releasedManagerIds.push(m.id)
    return { ...m, groupId: undefined, updatedAt: Date.now() }
  })
  if (!releasedManagerIds.length) return { vault, releasedManagerIds }
  return { vault: { ...vault, managers }, releasedManagerIds }
}

export function deleteManager(vault: VaultFileV1, id: string): VaultFileV1 | null {
  if (!findManager(vault, id)) return null
  return { ...vault, managers: vault.managers.filter((m) => m.id !== id) }
}

// ---- credentials ----------------------------------------------------------------------------

/** Cleartext rename — no key required, and deliberately never touches `secret`. */
export function renameCredential(
  vault: VaultFileV1,
  managerId: string,
  credentialId: string,
  label: string
): VaultFileV1 | null {
  const manager = findManager(vault, managerId)
  const credential = manager?.credentials.find((c) => c.id === credentialId)
  if (!manager || !credential) return null
  const trimmed = label.trim()
  if (!trimmed) return null
  const now = Date.now()
  return {
    ...vault,
    managers: vault.managers.map((m) =>
      m.id !== managerId
        ? m
        : {
            ...m,
            updatedAt: now,
            credentials: m.credentials.map((c) =>
              c.id === credentialId ? { ...c, label: trimmed, updatedAt: now } : c
            )
          }
    )
  }
}

/** Delete a credential outright. No key required — this only removes the (opaque) envelope, it
 *  never has to read it. */
export function removeCredential(vault: VaultFileV1, managerId: string, credentialId: string): VaultFileV1 | null {
  const manager = findManager(vault, managerId)
  if (!manager || !manager.credentials.some((c) => c.id === credentialId)) return null
  return {
    ...vault,
    managers: vault.managers.map((m) =>
      m.id !== managerId
        ? m
        : { ...m, updatedAt: Date.now(), credentials: m.credentials.filter((c) => c.id !== credentialId) }
    )
  }
}

/**
 * Every credential in one manager, as non-secret metadata: id, label, timestamps. Never the
 * envelope, and no key is required to ask.
 *
 * This closes the gap the panel was working around. Without it the only way a credential row
 * reached the UI was the create/rename/update call that produced it, so the panel kept a local
 * echo of what THIS session had touched and a credential from an earlier session existed only as
 * a number: "2 credentials" above a list showing none of them, with no way to reach them.
 *
 * Requiring no key is deliberate and consistent with `statusOf`, which already returns manager
 * names and counts to a locked caller. The same file states plainly that labels, ids and
 * timestamps are cleartext - that is what makes committing a vault to git no more dangerous than
 * committing project.json - so gating the labels here would protect nothing while leaving the
 * user unable to see what they own.
 *
 * `null` distinguishes "no such manager" from "a manager with no credentials", which the caller
 * needs: one is a stale id worth reporting, the other is an ordinary empty list.
 */
export function listCredentials(vault: VaultFileV1, managerId: string): CredentialSummary[] | null {
  const manager = findManager(vault, managerId)
  if (!manager) return null
  return manager.credentials.map(({ secret: _secret, ...meta }) => meta)
}

export interface NewCredentialInput {
  managerId: string
  label: string
  username: string
  password: string
  totpSecretBase32?: string
}

/** Requires the unlocked key — this is where a real secret first gets encrypted. */
export function createCredential(
  vault: VaultFileV1,
  key: Buffer,
  input: NewCredentialInput
): { vault: VaultFileV1; credential: CredentialRecord } | null {
  const manager = findManager(vault, input.managerId)
  if (!manager) return null
  const now = Date.now()
  const secret: CredentialSecret = {
    v: 1,
    username: input.username,
    password: input.password,
    totpSecretBase32: input.totpSecretBase32
  }
  const credential: CredentialRecord = {
    id: randomUUID(),
    label: input.label.trim() || 'Credential',
    createdAt: now,
    updatedAt: now,
    secret: encryptPayload(key, secret)
  }
  const managers = vault.managers.map((m) =>
    m.id === manager.id ? { ...m, updatedAt: now, credentials: [...m.credentials, credential] } : m
  )
  return { vault: { ...vault, managers }, credential }
}

export interface CredentialSecretPatch {
  username?: string
  password?: string
  /** `null` clears an existing second factor; `undefined` leaves it untouched. */
  totpSecretBase32?: string | null
}

/**
 * Update a credential's secret fields. Requires the unlocked key: this DECRYPTS the existing
 * envelope, merges the patch, and re-encrypts — the one credential-level mutation that touches
 * ciphertext. A wrong key throws `VaultCryptoError` from the `decryptPayload` call, before any
 * new document is assembled, so every OTHER manager and credential in `vault` — and this
 * credential's own PRIOR ciphertext — is left completely untouched (byte-identical on the next
 * read) if the call fails partway.
 */
export function updateCredentialSecret(
  vault: VaultFileV1,
  key: Buffer,
  managerId: string,
  credentialId: string,
  patch: CredentialSecretPatch
): VaultFileV1 | null {
  const manager = findManager(vault, managerId)
  const credential = manager?.credentials.find((c) => c.id === credentialId)
  if (!manager || !credential) return null
  const current = decryptPayload<CredentialSecret>(key, credential.secret)
  const next: CredentialSecret = {
    v: 1,
    username: patch.username ?? current.username,
    password: patch.password ?? current.password,
    totpSecretBase32:
      patch.totpSecretBase32 === null ? undefined : (patch.totpSecretBase32 ?? current.totpSecretBase32)
  }
  const now = Date.now()
  const encrypted = encryptPayload(key, next)
  return {
    ...vault,
    managers: vault.managers.map((m) =>
      m.id !== managerId
        ? m
        : {
            ...m,
            updatedAt: now,
            credentials: m.credentials.map((c) =>
              c.id === credentialId ? { ...c, secret: encrypted, updatedAt: now } : c
            )
          }
    )
  }
}

/** Decrypt one credential's secret half. Read-only — never mutates `vault`. Throws
 *  `VaultCryptoError` on a wrong key (see crypto.ts). */
export function revealCredential(
  vault: VaultFileV1,
  key: Buffer,
  managerId: string,
  credentialId: string
): CredentialSecret | null {
  const manager = findManager(vault, managerId)
  const credential = manager?.credentials.find((c) => c.id === credentialId)
  if (!manager || !credential) return null
  return decryptPayload<CredentialSecret>(key, credential.secret)
}

// ---- live TOTP code ---------------------------------------------------------------------------
// Deliberately fixed at the RFC 6238 conventional defaults (SHA1 / 6 digits / 30s) — the same
// defaults core/toylocks/totp.ts's `totp()` itself falls back to. Every password manager's TOTP
// enrollment is a single raw secret, not a full otpauth:// URI with custom parameters, matching
// the task's own wording ("a totp secret too").
const TOTP_ALGORITHM: OtpAlgorithm = 'SHA1'
const TOTP_DIGITS = 6
const TOTP_PERIOD = 30

export type CredentialCodeOutcome =
  | { kind: 'ok'; code: CredentialCode }
  | { kind: 'not-found' }
  | { kind: 'no-totp' }

export function credentialCode(
  vault: VaultFileV1,
  key: Buffer,
  managerId: string,
  credentialId: string
): CredentialCodeOutcome {
  const secret = revealCredential(vault, key, managerId, credentialId)
  if (!secret) return { kind: 'not-found' }
  if (!secret.totpSecretBase32) return { kind: 'no-totp' }
  const secretBytes = base32Decode(secret.totpSecretBase32)
  const nowS = Math.floor(Date.now() / 1000)
  const counter = totpCounterForTime(nowS, TOTP_PERIOD)
  return {
    kind: 'ok',
    code: {
      code: totp(secretBytes, {
        epochSeconds: nowS,
        period: TOTP_PERIOD,
        digits: TOTP_DIGITS,
        algorithm: TOTP_ALGORITHM
      }),
      next: totp(secretBytes, {
        epochSeconds: nowS + TOTP_PERIOD,
        period: TOTP_PERIOD,
        digits: TOTP_DIGITS,
        algorithm: TOTP_ALGORITHM
      }),
      periodStart: counter * TOTP_PERIOD,
      period: TOTP_PERIOD,
      digits: TOTP_DIGITS
    }
  }
}
