import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { VaultStore, vaultPathFor } from './vault-store'
import { createCredential, createManager, createVault, renameManager, revealCredential, unlockVault } from './vault'
import type { VaultFileV1, VaultKdfParams } from '../../shared/password-manager'

const FAST: VaultKdfParams = { N: 1024, r: 4, p: 1, keylen: 32 }

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'password-manager-vault-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('VaultStore.load', () => {
  it('a missing file reads as undefined ("uninitialized"), not an error', async () => {
    const store = new VaultStore()
    await expect(store.load(dir)).resolves.toBeUndefined()
  })

  it('a written vault loads back byte-for-byte equal', async () => {
    const store = new VaultStore()
    const created = await store.mutate<VaultFileV1>(dir, () => {
      const vault = createVault('project-password', FAST)
      return { changed: true, vault, result: vault }
    })
    const loaded = await store.load(dir)
    expect(loaded).toEqual(created)
  })

  it('corrupt (non-JSON) bytes REJECT rather than reading as "no vault"', async () => {
    const store = new VaultStore()
    const file = vaultPathFor(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'not json at all {{{')
    await expect(store.load(dir)).rejects.toThrow()
  })

  it('structurally-invalid JSON (valid JSON, wrong shape) also REJECTS', async () => {
    const store = new VaultStore()
    const file = vaultPathFor(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ version: 1, managers: 'not-an-array' }))
    await expect(store.load(dir)).rejects.toThrow()
  })
})

describe('VaultStore.mutate — creating a vault', () => {
  it('createVault via mutate persists to <cwd>/.nodeterm/vault.json', async () => {
    const store = new VaultStore()
    const result = await store.mutate(dir, (current) => {
      if (current) throw new Error('unexpected existing vault')
      const vault = createVault('pw', FAST)
      return { changed: true, vault, result: { ok: true } }
    })
    expect(result).toEqual({ ok: true })
    expect(fs.existsSync(vaultPathFor(dir))).toBe(true)
  })

  it('a mutation reporting changed:false writes nothing to disk', async () => {
    const store = new VaultStore()
    await store.mutate(dir, () => ({ changed: false, result: null }))
    expect(fs.existsSync(vaultPathFor(dir))).toBe(false)
  })

  it('changed:true with no vault throws (a mutation callback bug), and writes nothing', async () => {
    const store = new VaultStore()
    await expect(store.mutate(dir, () => ({ changed: true, result: null }) as never)).rejects.toThrow()
    expect(fs.existsSync(vaultPathFor(dir))).toBe(false)
  })
})

describe('VaultStore locked-state cache', () => {
  it('a fresh store is locked for every project until explicitly unlocked', async () => {
    const store = new VaultStore()
    await store.mutate(dir, () => ({ changed: true, vault: createVault('pw', FAST), result: null }))
    expect(store.isUnlocked(dir)).toBe(false)
    expect(store.keyFor(dir)).toBeUndefined()
  })

  it('unlock with the right password caches the key; wrong password does not', async () => {
    const store = new VaultStore()
    await store.mutate(dir, () => ({ changed: true, vault: createVault('pw', FAST), result: null }))
    expect(await store.unlock(dir, 'wrong')).toBe('wrong-password')
    expect(store.isUnlocked(dir)).toBe(false)

    expect(await store.unlock(dir, 'pw')).toBe('ok')
    expect(store.isUnlocked(dir)).toBe(true)
    expect(store.keyFor(dir)).toBeInstanceOf(Buffer)
  })

  it('unlock against a project with no vault at all reports no-vault', async () => {
    const store = new VaultStore()
    expect(await store.unlock(dir, 'anything')).toBe('no-vault')
  })

  it('lock() forgets the cached key; is idempotent', async () => {
    const store = new VaultStore()
    await store.mutate(dir, () => ({ changed: true, vault: createVault('pw', FAST), result: null }))
    await store.unlock(dir, 'pw')
    expect(store.isUnlocked(dir)).toBe(true)
    store.lock(dir)
    expect(store.isUnlocked(dir)).toBe(false)
    store.lock(dir) // idempotent, does not throw
  })

  it('two different projects (two cwds) track locked state independently', async () => {
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'password-manager-vault-b-'))
    try {
      const store = new VaultStore()
      await store.mutate(dir, () => ({ changed: true, vault: createVault('pw-a', FAST), result: null }))
      await store.mutate(dirB, () => ({ changed: true, vault: createVault('pw-b', FAST), result: null }))
      await store.unlock(dir, 'pw-a')
      expect(store.isUnlocked(dir)).toBe(true)
      expect(store.isUnlocked(dirB)).toBe(false)
    } finally {
      fs.rmSync(dirB, { recursive: true, force: true })
    }
  })
})

describe('the most dangerous failure: an undecryptable/locked manager survives load→save byte-identically', () => {
  it('a metadata-only mutation performed with NO key at all leaves every credential ciphertext untouched', async () => {
    const store = new VaultStore()

    // Create a vault with two managers and credentials in each, fully unlocked.
    const before = await store.mutate<VaultFileV1>(dir, () => {
      let vault = createVault('project-password', FAST)
      const key = unlockVault(vault, 'project-password')!
      const m1 = createManager(vault, { name: 'Team A' })
      vault = m1.vault
      const c1 = createCredential(vault, key, {
        managerId: m1.manager.id,
        label: 'GitHub',
        username: 'alice',
        password: 'hunter2'
      })!
      vault = c1.vault
      const m2 = createManager(vault, { name: 'Team B' })
      vault = m2.vault
      const c2 = createCredential(vault, key, {
        managerId: m2.manager.id,
        label: 'AWS',
        username: 'bob',
        password: 's3cr3t'
      })!
      vault = c2.vault
      return { changed: true, vault, result: vault }
    })

    // Start a FRESH store — brand new process, nobody has unlocked anything.
    const freshStore = new VaultStore()
    expect(freshStore.isUnlocked(dir)).toBe(false)

    // Perform a metadata-only mutation (rename one manager) with NO key at all.
    await freshStore.mutate<void>(dir, (current) => {
      const vault = renameManager(current!, before.managers[0].id, 'Team A (renamed)')!
      return { changed: true, vault, result: undefined }
    })

    const after = await freshStore.load(dir)

    // The rename took effect...
    expect(after!.managers.find((m) => m.id === before.managers[0].id)!.name).toBe('Team A (renamed)')

    // ...but EVERY credential's ciphertext, on BOTH managers, is byte-identical to before.
    for (const beforeManager of before.managers) {
      const afterManager = after!.managers.find((m) => m.id === beforeManager.id)!
      expect(afterManager.credentials).toHaveLength(beforeManager.credentials.length)
      for (const beforeCred of beforeManager.credentials) {
        const afterCred = afterManager.credentials.find((c) => c.id === beforeCred.id)!
        expect(afterCred.secret).toEqual(beforeCred.secret)
      }
    }

    // The vault's own kdf/salt/verifier — the password itself — are also untouched.
    expect(after!.kdf).toEqual(before.kdf)
    expect(after!.salt).toBe(before.salt)
    expect(after!.verifier).toEqual(before.verifier)

    // And the password that created the vault still unlocks it.
    expect(unlockVault(after!, 'project-password')).not.toBeNull()
  })
})

describe('no plaintext secret appears anywhere in the persisted vault file', () => {
  it('grep the raw bytes on disk for the username/password/totp secret', async () => {
    const store = new VaultStore()
    const PLAINTEXT_PASSWORD = 'super-secret-credential-password-xyz'
    const PLAINTEXT_USERNAME = 'very-identifiable-username-abc'
    const PLAINTEXT_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

    await store.mutate(dir, () => {
      let vault = createVault('the project password itself', FAST)
      const key = unlockVault(vault, 'the project password itself')!
      const m = createManager(vault, { name: 'M' })
      vault = m.vault
      const c = createCredential(vault, key, {
        managerId: m.manager.id,
        label: 'site',
        username: PLAINTEXT_USERNAME,
        password: PLAINTEXT_PASSWORD,
        totpSecretBase32: PLAINTEXT_TOTP
      })!
      vault = c.vault
      return { changed: true, vault, result: null }
    })

    const raw = fs.readFileSync(vaultPathFor(dir), 'utf8')
    expect(raw).not.toContain(PLAINTEXT_PASSWORD)
    expect(raw).not.toContain(PLAINTEXT_USERNAME)
    expect(raw).not.toContain(PLAINTEXT_TOTP)
    // The project password that derives the key must not appear either.
    expect(raw).not.toContain('the project password itself')
  })
})

describe('several managers in one project round-trip independently through the store', () => {
  it('each manager keeps its own credentials across a full save→load cycle', async () => {
    const store = new VaultStore()
    await store.mutate(dir, () => {
      let vault = createVault('pw', FAST)
      const key = unlockVault(vault, 'pw')!
      for (const [name, user, pass] of [
        ['A', 'ua', 'pa'],
        ['B', 'ub', 'pb'],
        ['C', 'uc', 'pc']
      ] as const) {
        const m = createManager(vault, { name })
        vault = m.vault
        const c = createCredential(vault, key, {
          managerId: m.manager.id,
          label: 'x',
          username: user,
          password: pass
        })!
        vault = c.vault
      }
      return { changed: true, vault, result: null }
    })

    const loaded = (await store.load(dir))!
    expect(loaded.managers).toHaveLength(3)
    await store.unlock(dir, 'pw')
    const key = store.keyFor(dir)!
    for (const [name, user, pass] of [
      ['A', 'ua', 'pa'],
      ['B', 'ub', 'pb'],
      ['C', 'uc', 'pc']
    ] as const) {
      const m = loaded.managers.find((mm) => mm.name === name)!
      const revealed = revealCredential(loaded, key, m.id, m.credentials[0].id)!
      expect(revealed.username).toBe(user)
      expect(revealed.password).toBe(pass)
    }
  })
})
