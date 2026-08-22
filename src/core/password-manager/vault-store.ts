// Per-project vault document I/O, plus the "locked state": whether THIS process currently holds
// the key a project's password derives.
//
// Deliberately its OWN sibling file, <cwd>/.nodeterm/vault.json — NOT a field on ProjectFileV1
// (core/workspace-files.ts). That file's own header states the rule this follows: ProjectFileV1
// "carries CONTENT ONLY. Nothing in here may be state two machines opening the same repo would
// legitimately disagree about" — and a vault genuinely doesn't fit that file's existing lifecycle
// either way: ProjectFileV1 has its own monotonic `rev` counter, SSH mirror/reconcile machinery,
// and `sameProjectContent` diffing, none of which a credential vault wants (a vault's own AEAD
// envelopes are already tamper-evident; layering another rev/merge story on top of them is pure
// risk for no benefit). core/board-log.ts already established the precedent for exactly this
// shape of per-project state — "board log" data that travels with a project but isn't part of the
// canvas document — by keeping its own sibling file (<cwd>/.nodeterm/board-log.jsonl) rather than
// growing project.json's schema; this follows the same choice.
//
// Everything written to that file is either non-secret metadata (manager/credential names, ids,
// timestamps, the KDF parameters, the salt) or an authenticated-encryption envelope nobody can
// read without the project password — exactly the property that makes committing it to git no
// more dangerous than committing project.json itself. See shared/password-manager.ts for the
// exact shape.

import path from 'path'
import { readAtomicFileSnapshot, withCrossProcessLock, writeAtomicFileCompared } from '../fs-transaction-lock'
import { assertValidVaultFile } from './vault'
import { unlockVault } from './vault'
import type { VaultFileV1 } from '../../shared/password-manager'

export const VAULT_DIR = '.nodeterm'
export const VAULT_FILE = 'vault.json'

export function vaultPathFor(cwd: string): string {
  return path.join(cwd, VAULT_DIR, VAULT_FILE)
}

export interface VaultMutation<TResult> {
  /** False leaves the current file byte-for-byte untouched — no write is attempted at all. */
  changed: boolean
  /** Required when `changed` is true: the COMPLETE next document (every mutation in vault.ts
   *  returns a whole new document rather than mutating in place, so there is nothing to merge
   *  here — this is simply what gets written). */
  vault?: VaultFileV1
  result: TResult
}

async function readVault(file: string): Promise<{ vault: VaultFileV1 | undefined; revision: string }> {
  const snapshot = await readAtomicFileSnapshot(file)
  if (!snapshot.exists) return { vault: undefined, revision: snapshot.revision }
  const parsed: unknown = JSON.parse(snapshot.data.toString('utf8'))
  assertValidVaultFile(parsed)
  return { vault: parsed, revision: snapshot.revision }
}

/**
 * Per-project vault document I/O + the in-memory unlocked-key cache. The key lives ONLY in
 * process memory, keyed by the resolved vault file path — never written anywhere, never persisted
 * across a restart. A fresh process starts every project LOCKED; there is no "remember my
 * password" option, by design (there is nowhere safe on this machine alone to keep a key that
 * would let a stolen laptop skip re-deriving it from the password).
 */
export class VaultStore {
  private readonly unlockedKeys = new Map<string, Buffer>()

  private file(cwd: string): string {
    return vaultPathFor(cwd)
  }

  private keyOf(cwd: string): string {
    return path.resolve(this.file(cwd))
  }

  /**
   * `undefined` = no vault has ever been created for this project ("uninitialized" in
   * shared/password-manager.ts's `VaultLockState` vocabulary) — a MISSING file, and only a
   * missing file, reads this way. Corrupt/unreadable input REJECTS (throws) rather than silently
   * reading as "uninitialized" — the same rule secure-store.ts's `load()` documents for exactly
   * the same reason: a read failure must never look, to a caller, like "there was nothing here to
   * lose".
   */
  async load(cwd: string): Promise<VaultFileV1 | undefined> {
    return (await readVault(this.file(cwd))).vault
  }

  isUnlocked(cwd: string): boolean {
    return this.unlockedKeys.has(this.keyOf(cwd))
  }

  /** The cached key for an unlocked project, or `undefined` if this process does not currently
   *  hold one (never yet unlocked, explicitly locked, or the process just restarted). */
  keyFor(cwd: string): Buffer | undefined {
    return this.unlockedKeys.get(this.keyOf(cwd))
  }

  /** Explicitly forget this project's cached key, if any. Idempotent. */
  lock(cwd: string): void {
    this.unlockedKeys.delete(this.keyOf(cwd))
  }

  /** Derive the key `password` implies and, if it matches the vault's canary, cache it for this
   *  process. Performs NO write — unlocking is purely a read + an in-memory cache update. */
  async unlock(cwd: string, password: string): Promise<'ok' | 'no-vault' | 'wrong-password'> {
    const vault = await this.load(cwd)
    if (!vault) return 'no-vault'
    const key = unlockVault(vault, password)
    if (!key) return 'wrong-password'
    this.unlockedKeys.set(this.keyOf(cwd), key)
    return 'ok'
  }

  /** Cache an already-derived key directly — used after `changeVaultPassword` re-derives the key
   *  under a new salt, so the process that just performed the change is not immediately reported
   *  as locked again. */
  cacheKey(cwd: string, key: Buffer): void {
    this.unlockedKeys.set(this.keyOf(cwd), key)
  }

  /**
   * Serialize one complete read/modify/write transaction for this project's vault, across every
   * process sharing the file (the same SQLite-backed cross-process lock secure-store.ts and every
   * other credential store in this app use — see fs-transaction-lock.ts). `mutation` receives the
   * CURRENT document (`undefined` if none exists yet) and returns the next one.
   *
   * A `mutation` that THROWS (a wrong or missing key attempting to touch a real secret — see
   * vault.ts's crypto-backed functions) aborts the whole transaction before any write: the
   * rejection propagates out of `withCrossProcessLock`'s callback, which is exactly "no bytes
   * published" — the same guarantee secure-store.ts's own `mutate()` gives its callers. This is
   * also how the "an undecryptable manager survives load→save byte-identically" requirement is
   * met: a mutation that never needed the key (renaming a manager, releasing a group binding,
   * deleting a credential) never reads or rewrites `secret` on any OTHER credential, so those
   * envelopes come back out of `JSON.stringify` exactly as they went in.
   */
  async mutate<TResult>(
    cwd: string,
    mutation: (vault: VaultFileV1 | undefined) => VaultMutation<TResult> | Promise<VaultMutation<TResult>>
  ): Promise<TResult> {
    const file = this.file(cwd)
    return withCrossProcessLock(file, async (lease) => {
      const { vault: current, revision } = await readVault(file)
      const change = await mutation(current)
      if (change.changed) {
        if (!change.vault) {
          throw new Error('A vault mutation reported changed:true without a next document')
        }
        assertValidVaultFile(change.vault)
        const data = JSON.stringify(change.vault, null, 2)
        await writeAtomicFileCompared(file, data, revision, lease)
      }
      return change.result
    })
  }
}
