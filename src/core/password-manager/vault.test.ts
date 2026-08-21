import { describe, expect, it } from 'vitest'
import { generateSecret, base32Encode } from '../toylocks/totp'
import {
  assertValidVaultFile,
  bindManagerToGroup,
  changeVaultPassword,
  createCredential,
  createManager,
  createVault,
  credentialCode,
  deleteManager,
  isValidVaultFile,
  releaseGroupBinding,
  removeCredential,
  renameCredential,
  renameManager,
  revealCredential,
  statusOf,
  unlockVault,
  updateCredentialSecret
} from './vault'
import { VaultCryptoError } from './crypto'
import type { VaultFileV1, VaultKdfParams } from '../../shared/password-manager'

// Fast KDF params for the whole suite — same shape DEFAULT_KDF_PARAMS uses, far cheaper.
const FAST: VaultKdfParams = { N: 1024, r: 4, p: 1, keylen: 32 }

function freshVault(password = 'correct horse battery staple'): VaultFileV1 {
  return createVault(password, FAST)
}

function unlock(vault: VaultFileV1, password: string): Buffer {
  const key = unlockVault(vault, password)
  if (!key) throw new Error('test setup: unlock failed')
  return key
}

describe('createVault / unlockVault', () => {
  it('a fresh vault is version 1, has a salt + verifier + kdf, and no managers', () => {
    const vault = freshVault()
    expect(vault.version).toBe(1)
    expect(vault.kdf).toEqual(FAST)
    expect(typeof vault.salt).toBe('string')
    expect(vault.managers).toEqual([])
  })

  it('the RIGHT password unlocks and returns a usable key', () => {
    const vault = freshVault('hunter2')
    const key = unlockVault(vault, 'hunter2')
    expect(key).not.toBeNull()
    expect(key).toHaveLength(FAST.keylen)
  })

  it('the WRONG password fails cleanly: returns null, never throws, never mutates the vault', () => {
    const vault = freshVault('hunter2')
    const before = JSON.stringify(vault)
    expect(unlockVault(vault, 'wrong password')).toBeNull()
    expect(JSON.stringify(vault)).toBe(before) // byte-identical — nothing was touched
  })

  it('two vaults from two different passwords have DIFFERENT salts (per-project, not reused)', () => {
    const a = freshVault('password-a')
    const b = freshVault('password-b')
    expect(a.salt).not.toBe(b.salt)
  })

  it('the SAME password on two separately-created vaults still gets different salts, and both unlock', () => {
    const a = freshVault('same password')
    const b = freshVault('same password')
    expect(a.salt).not.toBe(b.salt)
    expect(unlockVault(a, 'same password')).not.toBeNull()
    expect(unlockVault(b, 'same password')).not.toBeNull()
  })
})

describe('isValidVaultFile / assertValidVaultFile', () => {
  it('accepts a freshly created vault', () => {
    expect(isValidVaultFile(freshVault())).toBe(true)
    expect(() => assertValidVaultFile(freshVault())).not.toThrow()
  })

  it('rejects undefined/null/non-object input', () => {
    expect(isValidVaultFile(undefined)).toBe(false)
    expect(isValidVaultFile(null)).toBe(false)
    expect(isValidVaultFile('not an object')).toBe(false)
    expect(isValidVaultFile(42)).toBe(false)
  })

  it('rejects a document with duplicate manager ids', () => {
    const vault = freshVault()
    const { vault: v1, manager } = createManager(vault, { name: 'A' })
    const dup = { ...v1, managers: [...v1.managers, { ...manager }] }
    expect(isValidVaultFile(dup)).toBe(false)
  })

  it('rejects a manager with duplicate credential ids', () => {
    const vault = freshVault('pw')
    const key = unlock(vault, 'pw')
    const { vault: v1, manager } = createManager(vault, { name: 'A' })
    const created = createCredential(v1, key, {
      managerId: manager.id,
      label: 'site',
      username: 'u',
      password: 'p'
    })!
    const m = created.vault.managers[0]
    const dup = { ...created.vault, managers: [{ ...m, credentials: [...m.credentials, m.credentials[0]] }] }
    expect(isValidVaultFile(dup)).toBe(false)
  })

  it('rejects a manager id that is not a valid uuid v4', () => {
    const vault = freshVault()
    const { vault: v1, manager } = createManager(vault, { name: 'A' })
    const bad = { ...v1, managers: [{ ...manager, id: 'not-a-uuid' }] }
    expect(isValidVaultFile(bad)).toBe(false)
  })

  it('assertValidVaultFile throws on an invalid document', () => {
    expect(() => assertValidVaultFile({ version: 1 })).toThrow()
  })
})

describe('statusOf', () => {
  it('an undefined vault reports uninitialized with no managers', () => {
    expect(statusOf(undefined, false)).toEqual({ state: { kind: 'uninitialized' }, managers: [] })
  })

  it('a real vault reports locked/unlocked per the caller-supplied flag, regardless of password', () => {
    const vault = freshVault()
    expect(statusOf(vault, false).state).toEqual({ kind: 'locked' })
    expect(statusOf(vault, true).state).toEqual({ kind: 'unlocked' })
  })

  it('manager metadata is visible even when locked; credentials are represented only as a count', () => {
    const vault = freshVault('pw')
    const key = unlock(vault, 'pw')
    const { vault: v1, manager } = createManager(vault, { name: 'Team vault' })
    const { vault: v2 } = createCredential(v1, key, {
      managerId: manager.id,
      label: 'GitHub',
      username: 'octocat',
      password: 'secret'
    })!
    const status = statusOf(v2, false) // LOCKED — no key supplied
    expect(status.managers).toHaveLength(1)
    expect(status.managers[0].name).toBe('Team vault')
    expect(status.managers[0].credentialCount).toBe(1)
    expect(status.managers[0]).not.toHaveProperty('credentials')
  })
})

describe('managers — cleartext metadata, no key required', () => {
  it('createManager adds a manager with a trimmed name and no group binding by default', () => {
    const { vault, manager } = createManager(freshVault(), { name: '  My managers  ' })
    expect(manager.name).toBe('My managers')
    expect(manager.groupId).toBeUndefined()
    expect(vault.managers).toHaveLength(1)
  })

  it('createManager falls back to a default name for a blank/whitespace-only name', () => {
    const { manager } = createManager(freshVault(), { name: '   ' })
    expect(manager.name).toBe('Password manager')
  })

  it('createManager can bind a group id at creation', () => {
    const { manager } = createManager(freshVault(), { name: 'Feature X', groupId: 'group-1' })
    expect(manager.groupId).toBe('group-1')
  })

  it('renameManager renames and bumps updatedAt; unknown id returns null', () => {
    const { vault, manager } = createManager(freshVault(), { name: 'Old' })
    const renamed = renameManager(vault, manager.id, 'New name')!
    expect(renamed.managers[0].name).toBe('New name')
    expect(renamed.managers[0].updatedAt).toBeGreaterThanOrEqual(manager.updatedAt)
    expect(renameManager(vault, 'no-such-id', 'x')).toBeNull()
  })

  it('renameManager rejects a blank name (returns null, does not blank it out)', () => {
    const { vault, manager } = createManager(freshVault(), { name: 'Keep me' })
    expect(renameManager(vault, manager.id, '   ')).toBeNull()
  })

  it('bindManagerToGroup sets and clears the group id', () => {
    const { vault, manager } = createManager(freshVault(), { name: 'M' })
    const bound = bindManagerToGroup(vault, manager.id, 'group-9')!
    expect(bound.managers[0].groupId).toBe('group-9')
    const released = bindManagerToGroup(bound, manager.id, undefined)!
    expect(released.managers[0].groupId).toBeUndefined()
  })

  it('deleteManager removes it outright; unknown id returns null', () => {
    const { vault, manager } = createManager(freshVault(), { name: 'M' })
    const after = deleteManager(vault, manager.id)!
    expect(after.managers).toHaveLength(0)
    expect(deleteManager(vault, 'no-such-id')).toBeNull()
  })
})

describe('every cleartext manager mutation preserves the credentials it did not touch', () => {
  // releaseGroupBinding has its own byte-identical assertion below. The mutations here share its
  // exact `managers.map(m => m.id === id ? { ...m, <field> } : m)` shape, and that shape drops the
  // whole credential array the moment somebody writes `credentials:` into the spread by accident —
  // silently, with no error and no failing test. Measured: breaking renameManager to return
  // `credentials: []` left all 41 tests in this file green.
  //
  // The list is HAND-WRITTEN on purpose. A rule-shaped sweep ("every exported mutation preserves")
  // only ever checks the mutations it already found, so a new one added next year is covered by
  // nothing. Deleting a row here is visible in the diff; a missing row in a discovery loop is not.
  const MUTATIONS: ReadonlyArray<{
    readonly name: string
    readonly apply: (vault: VaultFileV1, managerId: string, credentialId: string) => VaultFileV1 | null
  }> = [
    { name: 'renameManager', apply: (v, id) => renameManager(v, id, 'A different name') },
    { name: 'bindManagerToGroup (bind)', apply: (v, id) => bindManagerToGroup(v, id, 'group-42') },
    { name: 'bindManagerToGroup (clear)', apply: (v, id) => bindManagerToGroup(v, id, undefined) },
    { name: 'renameCredential', apply: (v, id, credId) => renameCredential(v, id, credId, 'Renamed') }
  ]

  for (const mutation of MUTATIONS) {
    it(`${mutation.name} leaves the credential ciphertext byte-identical`, () => {
      const vault0 = freshVault('pw')
      const key = unlock(vault0, 'pw')
      const { vault: v1, manager } = createManager(vault0, { name: 'Before' })
      const { vault: v2, credential } = createCredential(v1, key, {
        managerId: manager.id,
        label: 'DB creds',
        username: 'root',
        password: 'p@ss'
      })!
      const after = mutation.apply(v2, manager.id, credential.id)
      expect(after).not.toBeNull()

      const survivor = after!.managers.find((m) => m.id === manager.id)!
      expect(survivor.credentials).toHaveLength(1)
      expect(survivor.credentials[0].id).toBe(credential.id)
      // Byte-identical, not merely decryptable: re-encrypting untouched data would still round-trip
      // while quietly rewriting bytes the user never asked to change.
      expect(survivor.credentials[0].secret).toEqual(credential.secret)

      // And it still opens under the same key.
      const revealed = revealCredential(after!, key, manager.id, credential.id)!
      expect(revealed.username).toBe('root')
      expect(revealed.password).toBe('p@ss')
    })
  }
})

describe('releaseGroupBinding — the worktree-release precedent, applied to a manager', () => {
  it('clears groupId on every manager bound to that group; NEVER deletes the manager or its credentials', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'Feature X', groupId: 'group-1' })
    const { vault: v2, credential } = createCredential(v1, key, {
      managerId: manager.id,
      label: 'DB creds',
      username: 'root',
      password: 'p@ss'
    })!

    const { vault: v3, releasedManagerIds } = releaseGroupBinding(v2, 'group-1')
    expect(releasedManagerIds).toEqual([manager.id])

    const survivor = v3.managers.find((m) => m.id === manager.id)!
    expect(survivor.groupId).toBeUndefined() // scope cleared
    expect(survivor.credentials).toHaveLength(1) // credential PRESERVED
    expect(survivor.credentials[0].id).toBe(credential.id)
    expect(survivor.credentials[0].secret).toEqual(credential.secret) // ciphertext byte-identical

    // The manager still round-trips its secret under the SAME key after release.
    const revealed = revealCredential(v3, key, manager.id, credential.id)!
    expect(revealed.username).toBe('root')
    expect(revealed.password).toBe('p@ss')
  })

  it('is a no-op (changed nothing) when no manager is bound to that group', () => {
    const { vault } = createManager(freshVault(), { name: 'Unbound' })
    const { vault: after, releasedManagerIds } = releaseGroupBinding(vault, 'no-such-group')
    expect(releasedManagerIds).toEqual([])
    expect(after).toBe(vault) // same reference — genuinely untouched
  })

  it('releases only managers bound to the released group, leaving others (including a DIFFERENT group) alone', () => {
    let vault = freshVault()
    ;({ vault } = createManager(vault, { name: 'A', groupId: 'group-1' }))
    ;({ vault } = createManager(vault, { name: 'B', groupId: 'group-2' }))
    ;({ vault } = createManager(vault, { name: 'C' })) // unbound
    const { vault: after, releasedManagerIds } = releaseGroupBinding(vault, 'group-1')
    expect(releasedManagerIds).toHaveLength(1)
    const byName = Object.fromEntries(after.managers.map((m) => [m.name, m.groupId]))
    expect(byName.A).toBeUndefined()
    expect(byName.B).toBe('group-2') // untouched
    expect(byName.C).toBeUndefined() // was already unbound, stays that way
  })
})

describe('credentials', () => {
  it('createCredential requires the key and fails to find an unknown manager', () => {
    const vault = freshVault('pw')
    const key = unlock(vault, 'pw')
    expect(createCredential(vault, key, { managerId: 'nope', label: 'x', username: 'u', password: 'p' })).toBeNull()
  })

  it('creates a credential whose secret round-trips through revealCredential', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    const secretB32 = base32Encode(generateSecret())
    const created = createCredential(v1, key, {
      managerId: manager.id,
      label: 'My site',
      username: 'alice',
      password: 'hunter2',
      totpSecretBase32: secretB32
    })!
    expect(created.credential.label).toBe('My site')
    const revealed = revealCredential(created.vault, key, manager.id, created.credential.id)!
    expect(revealed).toEqual({ v: 1, username: 'alice', password: 'hunter2', totpSecretBase32: secretB32 })
  })

  it('the persisted credential never carries the plaintext secret anywhere in its own JSON', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    const created = createCredential(v1, key, {
      managerId: manager.id,
      label: 'My site',
      username: 'alice-the-user',
      password: 'hunter2-super-secret',
      totpSecretBase32: 'JBSWY3DPEHPK3PXP'
    })!
    const wire = JSON.stringify(created.credential)
    expect(wire).not.toContain('hunter2-super-secret')
    expect(wire).not.toContain('alice-the-user')
    expect(wire).not.toContain('JBSWY3DPEHPK3PXP')
  })

  it('renameCredential is cleartext-only: never touches secret, works even with no key at all', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    const created = createCredential(v1, key, {
      managerId: manager.id,
      label: 'Old label',
      username: 'u',
      password: 'p'
    })!
    const renamed = renameCredential(created.vault, manager.id, created.credential.id, 'New label')!
    const cred = renamed.managers[0].credentials[0]
    expect(cred.label).toBe('New label')
    expect(cred.secret).toEqual(created.credential.secret) // byte-identical ciphertext
  })

  it('removeCredential deletes it outright; unknown id returns null', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    const created = createCredential(v1, key, { managerId: manager.id, label: 'x', username: 'u', password: 'p' })!
    const after = removeCredential(created.vault, manager.id, created.credential.id)!
    expect(after.managers[0].credentials).toHaveLength(0)
    expect(removeCredential(created.vault, manager.id, 'no-such-id')).toBeNull()
  })

  it('revealCredential with the WRONG key throws VaultCryptoError, never returns garbage', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    const created = createCredential(v1, key, { managerId: manager.id, label: 'x', username: 'u', password: 'p' })!
    const wrongKey = Buffer.alloc(FAST.keylen, 7)
    expect(() => revealCredential(created.vault, wrongKey, manager.id, created.credential.id)).toThrow(
      VaultCryptoError
    )
  })
})

describe('updateCredentialSecret', () => {
  function setup() {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    const created = createCredential(v1, key, {
      managerId: manager.id,
      label: 'x',
      username: 'alice',
      password: 'orig-pw',
      totpSecretBase32: 'AAAAAAAAAAAAAAAA'
    })!
    return { vault: created.vault, key, manager, credential: created.credential }
  }

  it('merges a partial patch (only password changes) while leaving username/totp untouched', () => {
    const { vault, key, manager, credential } = setup()
    const updated = updateCredentialSecret(vault, key, manager.id, credential.id, { password: 'new-pw' })!
    const revealed = revealCredential(updated, key, manager.id, credential.id)!
    expect(revealed).toEqual({ v: 1, username: 'alice', password: 'new-pw', totpSecretBase32: 'AAAAAAAAAAAAAAAA' })
  })

  it('totpSecretBase32: null clears the second factor; undefined leaves it alone', () => {
    const { vault, key, manager, credential } = setup()
    const cleared = updateCredentialSecret(vault, key, manager.id, credential.id, { totpSecretBase32: null })!
    expect(revealCredential(cleared, key, manager.id, credential.id)!.totpSecretBase32).toBeUndefined()

    const untouched = updateCredentialSecret(vault, key, manager.id, credential.id, {})!
    expect(revealCredential(untouched, key, manager.id, credential.id)!.totpSecretBase32).toBe('AAAAAAAAAAAAAAAA')
  })

  it('updating one credential leaves a SIBLING credential byte-identical (never re-encrypts what it did not touch)', () => {
    const { vault, key, manager, credential } = setup()
    const created2 = createCredential(vault, key, { managerId: manager.id, label: 'y', username: 'u2', password: 'p2' })!
    const before = created2.vault.managers[0].credentials.find((c) => c.id !== credential.id)!.secret

    const updated = updateCredentialSecret(created2.vault, key, manager.id, credential.id, { password: 'z' })!
    const sibling = updated.managers[0].credentials.find((c) => c.id !== credential.id)!.secret
    expect(sibling).toEqual(before)
  })

  it('a WRONG key throws before producing any new document (the caller sees no partial write)', () => {
    const { vault, manager, credential } = setup()
    const wrongKey = Buffer.alloc(FAST.keylen, 9)
    expect(() =>
      updateCredentialSecret(vault, wrongKey, manager.id, credential.id, { password: 'x' })
    ).toThrow(VaultCryptoError)
  })

  it('unknown manager/credential id returns null (no key spent, nothing thrown)', () => {
    const { vault, key, manager } = setup()
    expect(updateCredentialSecret(vault, key, manager.id, 'no-such-id', { password: 'x' })).toBeNull()
    expect(updateCredentialSecret(vault, key, 'no-such-manager', 'no-such-id', { password: 'x' })).toBeNull()
  })
})

describe('credentialCode — live TOTP', () => {
  it('returns a 6-digit code for a credential with a TOTP secret', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    const secretB32 = base32Encode(generateSecret())
    const created = createCredential(v1, key, {
      managerId: manager.id,
      label: 'x',
      username: 'u',
      password: 'p',
      totpSecretBase32: secretB32
    })!
    const outcome = credentialCode(created.vault, key, manager.id, created.credential.id)
    expect(outcome.kind).toBe('ok')
    if (outcome.kind === 'ok') {
      expect(outcome.code.code).toMatch(/^\d{6}$/)
      expect(outcome.code.digits).toBe(6)
      expect(outcome.code.period).toBe(30)
    }
  })

  it('reports no-totp for a credential without a second factor', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    const created = createCredential(v1, key, { managerId: manager.id, label: 'x', username: 'u', password: 'p' })!
    expect(credentialCode(created.vault, key, manager.id, created.credential.id).kind).toBe('no-totp')
  })

  it('reports not-found for an unknown credential', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    expect(credentialCode(v1, key, manager.id, 'no-such-id').kind).toBe('not-found')
  })
})

describe('changeVaultPassword — the one path that re-encrypts EVERYTHING, on purpose', () => {
  it('re-encrypts every credential under the new password and rotates the salt', () => {
    const vault0 = freshVault('old-pw')
    const key = unlock(vault0, 'old-pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    const c1 = createCredential(v1, key, { managerId: manager.id, label: 'a', username: 'u1', password: 'p1' })!
    const c2 = createCredential(c1.vault, key, { managerId: manager.id, label: 'b', username: 'u2', password: 'p2' })!

    const changed = changeVaultPassword(c2.vault, key, 'new-pw', FAST)
    expect(changed.salt).not.toBe(v1.salt)

    // Old password no longer works.
    expect(unlockVault(changed, 'old-pw')).toBeNull()
    // New password works and decrypts every credential correctly.
    const newKey = unlockVault(changed, 'new-pw')!
    const m = changed.managers[0]
    const revealed1 = revealCredential(changed, newKey, m.id, c1.credential.id)!
    const revealed2 = revealCredential(changed, newKey, m.id, c2.credential.id)!
    expect(revealed1.password).toBe('p1')
    expect(revealed2.password).toBe('p2')
  })

  it('a WRONG current key throws before producing any output (original vault is untouched)', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager } = createManager(vault0, { name: 'M' })
    const c1 = createCredential(v1, key, { managerId: manager.id, label: 'a', username: 'u', password: 'p' })!
    const before = JSON.stringify(c1.vault)

    const wrongKey = Buffer.alloc(FAST.keylen, 3)
    expect(() => changeVaultPassword(c1.vault, wrongKey, 'new-pw', FAST)).toThrow(VaultCryptoError)
    expect(JSON.stringify(c1.vault)).toBe(before) // never mutated
  })
})

describe('several managers in one project each round-trip independently', () => {
  it('two managers with their own credentials never cross-contaminate on reveal, rename, or delete', () => {
    const vault0 = freshVault('pw')
    const key = unlock(vault0, 'pw')
    const { vault: v1, manager: mA } = createManager(vault0, { name: 'A', groupId: 'g-a' })
    const { vault: v2, manager: mB } = createManager(v1, { name: 'B', groupId: 'g-b' })
    const credA = createCredential(v2, key, { managerId: mA.id, label: 'a-cred', username: 'ua', password: 'pa' })!
    const credB = createCredential(credA.vault, key, { managerId: mB.id, label: 'b-cred', username: 'ub', password: 'pb' })!

    const revealedA = revealCredential(credB.vault, key, mA.id, credA.credential.id)!
    const revealedB = revealCredential(credB.vault, key, mB.id, credB.credential.id)!
    expect(revealedA.password).toBe('pa')
    expect(revealedB.password).toBe('pb')

    // Releasing A's group leaves B's binding intact.
    const { vault: v3 } = releaseGroupBinding(credB.vault, 'g-a')
    expect(v3.managers.find((m) => m.id === mA.id)!.groupId).toBeUndefined()
    expect(v3.managers.find((m) => m.id === mB.id)!.groupId).toBe('g-b')

    // Deleting A leaves B (and its credential) fully intact.
    const v4 = deleteManager(v3, mA.id)!
    expect(v4.managers).toHaveLength(1)
    expect(v4.managers[0].id).toBe(mB.id)
    expect(revealCredential(v4, key, mB.id, credB.credential.id)!.password).toBe('pb')
  })
})
