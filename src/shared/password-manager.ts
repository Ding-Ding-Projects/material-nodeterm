// Real password managers, living inside a project — the user's own words: "projects are still
// projects... but it can have its own password managers, and can even have one password manager
// per group too!!". Unlike the toy locks in shared/toylock.ts (deliberately NOT security, a
// self-imposed speed bump), this IS real credential storage: every secret half of a credential
// (username, password, TOTP secret) is authenticated-encrypted with a key derived from ONE
// password per project ("'Encryption' is by project password") and never appears in cleartext
// outside core/password-manager/vault.ts's deliberate decrypt path.
//
// See core/password-manager/vault-store.ts's header for why this lives in its own sibling file
// (<cwd>/.nodeterm/vault.json) rather than as a field on ProjectFileV1 (workspace-files.ts).

export interface EncryptedPayload {
  v: 1
  /** base64 AES-256-GCM nonce (12 bytes). */
  iv: string
  /** base64 ciphertext. */
  ciphertext: string
  /** base64 auth tag (16 bytes) — a tampered ciphertext or a wrong key fails to authenticate and
   *  is refused before any bytes are returned; see core/password-manager/crypto.ts. */
  tag: string
}

export interface VaultKdfParams {
  N: number
  r: number
  p: number
  keylen: number
}

/** One credential's SECRET half — what an `EncryptedPayload` on a `CredentialRecord` decrypts to.
 *  Never appears in cleartext outside a deliberate unlock+reveal/update call. */
export interface CredentialSecret {
  v: 1
  username: string
  password: string
  /** RFC 4648 base32, same convention core/toylocks/totp.ts already uses. Absent = this
   *  credential has no second factor. */
  totpSecretBase32?: string
}

/** Non-secret metadata for one credential — safe to hand to a renderer/list UI without unlocking
 *  the vault. `secret` stays the opaque envelope. */
export interface CredentialRecord {
  id: string
  label: string
  createdAt: number
  updatedAt: number
  secret: EncryptedPayload
}

export interface PasswordManagerRecord {
  id: string
  name: string
  /** A canvas GROUP node id this manager is scoped to, or absent for a project-scoped manager.
   *  Cleared — never removed, and the manager and its credentials are never deleted along with
   *  it — when the group is ungrouped/deleted. See core/password-manager/vault.ts's
   *  `releaseGroupBinding`, the counterpart of Canvas.tsx's `releaseWorktreeBinding` for
   *  `GroupWorktree` (shared/worktree.ts). */
  groupId?: string
  createdAt: number
  updatedAt: number
  credentials: CredentialRecord[]
}

/** On-disk shape of <cwd>/.nodeterm/vault.json. */
export interface VaultFileV1 {
  version: 1
  kdf: VaultKdfParams
  /** base64 per-project random salt, paired with `kdf` so any machine with the SAME password
   *  derives the SAME key. Never secret on its own. */
  salt: string
  /** The empty-plaintext canary: decrypting THIS with a candidate key is how a password is
   *  checked without ever touching a real credential. */
  verifier: EncryptedPayload
  managers: PasswordManagerRecord[]
}

export type VaultLockState =
  | { kind: 'uninitialized' } // no project password has ever been set for this project
  | { kind: 'locked' } // a password is set, but this process has not (yet) supplied it
  | { kind: 'unlocked' }
  // This project has nowhere local to keep a vault (an SSH-ref project, or a cwd-less inline
  // canvas). v1 is local-only, so say so rather than offering a form that can only fail.
  | { kind: 'unsupported' }

/** What a manager list looks like to a caller that may or may not currently hold the key —
 *  metadata is always visible; `credentialCount` stands in for the credentials themselves, which
 *  stay opaque until something explicitly reveals one. */
export type PasswordManagerSummary = Omit<PasswordManagerRecord, 'credentials'> & {
  credentialCount: number
}

export interface VaultStatus {
  state: VaultLockState
  managers: PasswordManagerSummary[]
}

export type CredentialSummary = Omit<CredentialRecord, 'secret'>

export type VaultCreateResult = { ok: true } | { ok: false; error: 'already-initialized' | 'unsupported' }

export type VaultUnlockResult =
  | { ok: true }
  | { ok: false; error: 'no-password-set' | 'wrong-password' | 'unsupported' }

export interface ChangeVaultPasswordInput {
  currentPassword: string
  newPassword: string
}

export type ChangeVaultPasswordResult =
  | { ok: true }
  | { ok: false; error: 'wrong-password' | 'uninitialized' | 'unsupported' }

export interface CreateManagerInput {
  name: string
  groupId?: string
}

export type CreateManagerResult =
  | { ok: true; manager: PasswordManagerSummary }
  | { ok: false; error: string }

export interface RenameManagerInput {
  id: string
  name: string
}

export interface BindManagerGroupInput {
  id: string
  /** Absent/undefined = release to project scope. */
  groupId?: string
}

export type ManagerMutationResult = { ok: true } | { ok: false; error: 'not-found' | 'unsupported' }

export interface ReleaseGroupBindingResult {
  releasedManagerIds: string[]
}

export interface CreateCredentialInput {
  managerId: string
  label: string
  username: string
  password: string
  totpSecretBase32?: string
}

export type CreateCredentialResult =
  | { ok: true; credential: CredentialSummary }
  | { ok: false; error: 'not-found' | 'locked' | 'unsupported' }

export interface RenameCredentialInput {
  managerId: string
  credentialId: string
  label: string
}

export interface UpdateCredentialSecretInput {
  managerId: string
  credentialId: string
  username?: string
  password?: string
  /** `null` clears an existing second factor; `undefined` leaves it untouched. */
  totpSecretBase32?: string | null
}

export type UpdateCredentialResult = { ok: true } | { ok: false; error: 'not-found' | 'locked' | 'unsupported' }

export interface RemoveCredentialInput {
  managerId: string
  credentialId: string
}

export type RemoveCredentialResult = { ok: true } | { ok: false; error: 'not-found' | 'unsupported' }

export type RevealCredentialResult =
  | { ok: true; username: string; password: string; totpSecretBase32?: string }
  | { ok: false; error: 'not-found' | 'locked' | 'unsupported' }

export interface CredentialCode {
  code: string
  next: string
  /** Epoch seconds the CURRENT code's period started. */
  periodStart: number
  period: number
  digits: number
}

export type CredentialCodeResult =
  | { ok: true; code: CredentialCode }
  | { ok: false; error: 'not-found' | 'locked' | 'no-totp' | 'unsupported' }
