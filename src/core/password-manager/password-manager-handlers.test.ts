import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fakePlatform, type FakePlatform } from '../platform-fake'
import {
  registerPasswordManagerHandlers,
  type PasswordManagerRoute,
  type PasswordManagerRouter
} from './password-manager-handlers'
import { VaultStore, vaultPathFor } from './vault-store'
import { IPC } from '../../shared/ipc'
import type {
  ChangeVaultPasswordResult,
  CreateCredentialResult,
  CreateManagerResult,
  CredentialCodeResult,
  ManagerMutationResult,
  ReleaseGroupBindingResult,
  RemoveCredentialResult,
  RevealCredentialResult,
  UpdateCredentialResult,
  VaultCreateResult,
  VaultStatus,
  VaultUnlockResult
} from '../../shared/password-manager'

// A router that always answers with one fixed route — most tests need only one project.
const routerFor = (route: PasswordManagerRoute): PasswordManagerRouter => ({ route: () => route })

const PID = 'p1'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-pwmgr-h-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

function wire(f: FakePlatform = fakePlatform()): { f: FakePlatform; store: VaultStore } {
  const store = new VaultStore()
  registerPasswordManagerHandlers(f, routerFor({ kind: 'local', cwd: dir }), store)
  return { f, store }
}

const status = (f: FakePlatform, pid = PID) => f.handlers[IPC.passwordManagerStatus](pid) as Promise<VaultStatus>
const createVault = (f: FakePlatform, pw: string, pid = PID) =>
  f.handlers[IPC.passwordManagerCreateVault](pid, pw) as Promise<VaultCreateResult>
const unlock = (f: FakePlatform, pw: string, pid = PID) =>
  f.handlers[IPC.passwordManagerUnlock](pid, pw) as Promise<VaultUnlockResult>
const lock = (f: FakePlatform, pid = PID) => f.handlers[IPC.passwordManagerLock](pid) as Promise<void>
const changePassword = (f: FakePlatform, input: unknown, pid = PID) =>
  f.handlers[IPC.passwordManagerChangePassword](pid, input) as Promise<ChangeVaultPasswordResult>
const createManager = (f: FakePlatform, input: unknown, pid = PID) =>
  f.handlers[IPC.passwordManagerCreateManager](pid, input) as Promise<CreateManagerResult>
const renameManager = (f: FakePlatform, input: unknown, pid = PID) =>
  f.handlers[IPC.passwordManagerRenameManager](pid, input) as Promise<ManagerMutationResult>
const bindGroup = (f: FakePlatform, input: unknown, pid = PID) =>
  f.handlers[IPC.passwordManagerBindManagerGroup](pid, input) as Promise<ManagerMutationResult>
const releaseGroup = (f: FakePlatform, groupId: string, pid = PID) =>
  f.handlers[IPC.passwordManagerReleaseGroupBinding](pid, groupId) as Promise<ReleaseGroupBindingResult>
const deleteManager = (f: FakePlatform, id: string, pid = PID) =>
  f.handlers[IPC.passwordManagerDeleteManager](pid, id) as Promise<ManagerMutationResult>
const createCredential = (f: FakePlatform, input: unknown, pid = PID) =>
  f.handlers[IPC.passwordManagerCreateCredential](pid, input) as Promise<CreateCredentialResult>
const renameCredential = (f: FakePlatform, input: unknown, pid = PID) =>
  f.handlers[IPC.passwordManagerRenameCredential](pid, input) as Promise<ManagerMutationResult>
const updateSecret = (f: FakePlatform, input: unknown, pid = PID) =>
  f.handlers[IPC.passwordManagerUpdateCredentialSecret](pid, input) as Promise<UpdateCredentialResult>
const removeCredential = (f: FakePlatform, input: unknown, pid = PID) =>
  f.handlers[IPC.passwordManagerRemoveCredential](pid, input) as Promise<RemoveCredentialResult>
const reveal = (f: FakePlatform, managerId: string, credentialId: string, pid = PID) =>
  f.handlers[IPC.passwordManagerRevealCredential](pid, managerId, credentialId) as Promise<RevealCredentialResult>
const code = (f: FakePlatform, managerId: string, credentialId: string, pid = PID) =>
  f.handlers[IPC.passwordManagerCredentialCode](pid, managerId, credentialId) as Promise<CredentialCodeResult>

describe('registerPasswordManagerHandlers — routing', () => {
  it('unsupported route: status reports unsupported, and every mutating call refuses cleanly', async () => {
    const { f } = wire(fakePlatform())
    registerPasswordManagerHandlers(fakePlatform(), routerFor({ kind: 'unsupported' }))
    const g = fakePlatform()
    registerPasswordManagerHandlers(g, routerFor({ kind: 'unsupported' }))

    expect(await status(g)).toEqual({ state: { kind: 'unsupported' }, managers: [] })
    expect(await createVault(g, 'pw')).toEqual({ ok: false, error: 'unsupported' })
    expect(await unlock(g, 'pw')).toEqual({ ok: false, error: 'unsupported' })
    expect(await createManager(g, { name: 'x' })).toMatchObject({ ok: false })
    void f // silence unused-binding lint on the throwaway wired instance above
  })

  it('local route: no vault has ever been created → status is uninitialized, no file on disk', async () => {
    const { f } = wire()
    expect(await status(f)).toEqual({ state: { kind: 'uninitialized' }, managers: [] })
    expect(fs.existsSync(vaultPathFor(dir))).toBe(false)
  })
})

describe('vault lifecycle', () => {
  it('createVault succeeds once, and a SECOND create on the same project is refused', async () => {
    const { f } = wire()
    expect(await createVault(f, 'pw')).toEqual({ ok: true })
    expect(fs.existsSync(vaultPathFor(dir))).toBe(true)
    expect(await createVault(f, 'other-pw')).toEqual({ ok: false, error: 'already-initialized' })
  })

  it('status reports locked immediately after create (this process has not unlocked it)', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    expect((await status(f)).state).toEqual({ kind: 'locked' })
  })

  it('unlock with the right password flips status to unlocked; wrong password does not', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    expect(await unlock(f, 'wrong')).toEqual({ ok: false, error: 'wrong-password' })
    expect((await status(f)).state).toEqual({ kind: 'locked' })

    expect(await unlock(f, 'pw')).toEqual({ ok: true })
    expect((await status(f)).state).toEqual({ kind: 'unlocked' })
  })

  it('unlock against a project with no vault at all reports no-password-set', async () => {
    const { f } = wire()
    expect(await unlock(f, 'anything')).toEqual({ ok: false, error: 'no-password-set' })
  })

  it('lock() flips status back to locked', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    await unlock(f, 'pw')
    expect((await status(f)).state).toEqual({ kind: 'unlocked' })
    await lock(f)
    expect((await status(f)).state).toEqual({ kind: 'locked' })
  })

  it('changePassword: wrong current password refuses and re-derives nothing', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    const result = await changePassword(f, { currentPassword: 'wrong', newPassword: 'new-pw' })
    expect(result).toEqual({ ok: false, error: 'wrong-password' })
    // The OLD password still works — nothing was rotated.
    expect(await unlock(f, 'pw')).toEqual({ ok: true })
  })

  it('changePassword: right current password rotates it, and the caller is left unlocked under the NEW one', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    const result = await changePassword(f, { currentPassword: 'pw', newPassword: 'new-pw' })
    expect(result).toEqual({ ok: true })
    expect((await status(f)).state).toEqual({ kind: 'unlocked' }) // re-cached under the new password

    // Old password is dead; new one works from a fresh (locked) process.
    const { f: fresh } = wire()
    expect(await unlock(fresh, 'pw')).toEqual({ ok: false, error: 'wrong-password' })
    expect(await unlock(fresh, 'new-pw')).toEqual({ ok: true })
  })

  it('changePassword against an uninitialized project reports uninitialized', async () => {
    const { f } = wire()
    expect(await changePassword(f, { currentPassword: 'x', newPassword: 'y' })).toEqual({
      ok: false,
      error: 'uninitialized'
    })
  })
})

describe('managers', () => {
  it('createManager refuses before a project password has been set', async () => {
    const { f } = wire()
    const result = await createManager(f, { name: 'M' })
    expect(result.ok).toBe(false)
  })

  it('createManager succeeds once a vault exists, even while LOCKED (metadata only)', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    // Deliberately never unlocked.
    const result = await createManager(f, { name: 'Team A' })
    expect(result).toMatchObject({ ok: true, manager: { name: 'Team A', credentialCount: 0 } })
  })

  it('renameManager works while locked; unknown id reports not-found', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    const created = (await createManager(f, { name: 'Old' })) as Extract<CreateManagerResult, { ok: true }>
    expect(await renameManager(f, { id: created.manager.id, name: 'New' })).toEqual({ ok: true })
    expect((await status(f)).managers[0].name).toBe('New')
    expect(await renameManager(f, { id: 'no-such-id', name: 'x' })).toEqual({ ok: false, error: 'not-found' })
  })

  it('bindManagerToGroup and releaseGroupBinding round-trip a group scope', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    const created = (await createManager(f, { name: 'M' })) as Extract<CreateManagerResult, { ok: true }>
    expect(await bindGroup(f, { id: created.manager.id, groupId: 'grp-1' })).toEqual({ ok: true })
    expect((await status(f)).managers[0].groupId).toBe('grp-1')

    const released = await releaseGroup(f, 'grp-1')
    expect(released.releasedManagerIds).toEqual([created.manager.id])
    expect((await status(f)).managers[0].groupId).toBeUndefined()
    // The manager itself still exists — releasing a binding never deletes it.
    expect((await status(f)).managers).toHaveLength(1)
  })

  it('releaseGroupBinding on an unbound group id is a harmless no-op', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    await createManager(f, { name: 'M' })
    expect(await releaseGroup(f, 'no-such-group')).toEqual({ releasedManagerIds: [] })
  })

  it('deleteManager removes it outright', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    const created = (await createManager(f, { name: 'M' })) as Extract<CreateManagerResult, { ok: true }>
    expect(await deleteManager(f, created.manager.id)).toEqual({ ok: true })
    expect((await status(f)).managers).toHaveLength(0)
  })
})

describe('credentials', () => {
  async function setup(): Promise<{ f: FakePlatform; managerId: string }> {
    const { f } = wire()
    await createVault(f, 'pw')
    await unlock(f, 'pw')
    const created = (await createManager(f, { name: 'M' })) as Extract<CreateManagerResult, { ok: true }>
    return { f, managerId: created.manager.id }
  }

  it('createCredential refuses with "locked" when no key is cached, even though a vault exists', async () => {
    const { f } = wire()
    await createVault(f, 'pw')
    const created = (await createManager(f, { name: 'M' })) as Extract<CreateManagerResult, { ok: true }>
    // Deliberately never unlocked in THIS handler instance.
    const result = await createCredential(f, {
      managerId: created.manager.id,
      label: 'x',
      username: 'u',
      password: 'p'
    })
    expect(result).toEqual({ ok: false, error: 'locked' })
  })

  it('createCredential succeeds once unlocked, and reveal round-trips the secret', async () => {
    const { f, managerId } = await setup()
    const created = (await createCredential(f, {
      managerId,
      label: 'GitHub',
      username: 'octocat',
      password: 'hunter2',
      totpSecretBase32: 'JBSWY3DPEHPK3PXP'
    })) as Extract<CreateCredentialResult, { ok: true }>
    expect(created.credential.label).toBe('GitHub')
    expect(created.credential).not.toHaveProperty('secret')

    const revealed = await reveal(f, managerId, created.credential.id)
    expect(revealed).toEqual({ ok: true, username: 'octocat', password: 'hunter2', totpSecretBase32: 'JBSWY3DPEHPK3PXP' })
  })

  it('reveal on a LOCKED (freshly booted) store reports locked, never returns the secret', async () => {
    const { f, managerId } = await setup()
    const created = (await createCredential(f, {
      managerId,
      label: 'x',
      username: 'u',
      password: 'p'
    })) as Extract<CreateCredentialResult, { ok: true }>

    await lock(f)
    expect(await reveal(f, managerId, created.credential.id)).toEqual({ ok: false, error: 'locked' })
  })

  it('renameCredential works while locked (cleartext-only)', async () => {
    const { f, managerId } = await setup()
    const created = (await createCredential(f, {
      managerId,
      label: 'Old',
      username: 'u',
      password: 'p'
    })) as Extract<CreateCredentialResult, { ok: true }>
    await lock(f)
    expect(await renameCredential(f, { managerId, credentialId: created.credential.id, label: 'New' })).toEqual({
      ok: true
    })
  })

  it('updateCredentialSecret refuses while locked, and succeeds once unlocked', async () => {
    const { f, managerId } = await setup()
    const created = (await createCredential(f, {
      managerId,
      label: 'x',
      username: 'u',
      password: 'orig'
    })) as Extract<CreateCredentialResult, { ok: true }>

    await lock(f)
    expect(
      await updateSecret(f, { managerId, credentialId: created.credential.id, password: 'new' })
    ).toEqual({ ok: false, error: 'locked' })

    await unlock(f, 'pw')
    expect(
      await updateSecret(f, { managerId, credentialId: created.credential.id, password: 'new' })
    ).toEqual({ ok: true })
    expect((await reveal(f, managerId, created.credential.id)) as Extract<RevealCredentialResult, { ok: true }>).toMatchObject({
      password: 'new'
    })
  })

  it('removeCredential deletes it; unknown id reports not-found', async () => {
    const { f, managerId } = await setup()
    const created = (await createCredential(f, {
      managerId,
      label: 'x',
      username: 'u',
      password: 'p'
    })) as Extract<CreateCredentialResult, { ok: true }>
    expect(await removeCredential(f, { managerId, credentialId: created.credential.id })).toEqual({ ok: true })
    expect(await removeCredential(f, { managerId, credentialId: created.credential.id })).toEqual({
      ok: false,
      error: 'not-found'
    })
  })

  it('credentialCode reports no-totp, then a real code once a TOTP secret is set, and locked once relocked', async () => {
    const { f, managerId } = await setup()
    const created = (await createCredential(f, {
      managerId,
      label: 'x',
      username: 'u',
      password: 'p'
    })) as Extract<CreateCredentialResult, { ok: true }>

    expect(await code(f, managerId, created.credential.id)).toEqual({ ok: false, error: 'no-totp' })

    await updateSecret(f, { managerId, credentialId: created.credential.id, totpSecretBase32: 'JBSWY3DPEHPK3PXP' })
    const withCode = await code(f, managerId, created.credential.id)
    expect(withCode.ok).toBe(true)
    if (withCode.ok) expect(withCode.code.code).toMatch(/^\d{6}$/)

    await lock(f)
    expect(await code(f, managerId, created.credential.id)).toEqual({ ok: false, error: 'locked' })
  })
})

describe('several projects are independent', () => {
  it('two projects routed to two different cwds never see each other\'s vault', async () => {
    const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-pwmgr-h-b-'))
    try {
      const f = fakePlatform()
      registerPasswordManagerHandlers(f, {
        route: (pid) => (pid === 'A' ? { kind: 'local', cwd: dir } : { kind: 'local', cwd: dirB })
      })
      const createA = f.handlers[IPC.passwordManagerCreateVault]
      await createA('A', 'pw-a')
      await createA('B', 'pw-b')

      const unlockA = f.handlers[IPC.passwordManagerUnlock]
      expect(await unlockA('A', 'pw-b')).toEqual({ ok: false, error: 'wrong-password' })
      expect(await unlockA('A', 'pw-a')).toEqual({ ok: true })
      expect(await unlockA('B', 'pw-a')).toEqual({ ok: false, error: 'wrong-password' })
      expect(await unlockA('B', 'pw-b')).toEqual({ ok: true })
    } finally {
      fs.rmSync(dirB, { recursive: true, force: true })
    }
  })
})
