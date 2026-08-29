// Password-manager RPC surface, registered ONCE for every shell (Electron main + Server Edition)
// through CorePlatform — the same seam board-log-handlers.ts uses, so the two can never drift.
// The pure vault operations already live in vault.ts / vault-store.ts; this only wires
// request/response and delegates "where does this project's vault live?" to an injected
// PasswordManagerRouter, exactly like BoardLogRouter.
//
// v1 is LOCAL-ONLY, same starting scope board-log-handlers.ts shipped with: an SSH-ref project
// (or a cwd-less inline canvas) answers `unsupported` rather than guessing at a remote path. A
// remote leg can be added later by widening the router, the same way board log's was.

import type { CorePlatform } from '../platform'
import { IPC } from '../../shared/ipc'
import { VaultStore } from './vault-store'
import { VaultCryptoError } from './crypto'
import {
  bindManagerToGroup,
  changeVaultPassword,
  createCredential,
  createManager,
  createVault,
  credentialCode,
  listCredentials,
  deleteManager,
  releaseGroupBinding,
  removeCredential,
  renameCredential,
  renameManager,
  revealCredential,
  statusOf,
  unlockVault,
  updateCredentialSecret
} from './vault'
import type {
  BindManagerGroupInput,
  ChangeVaultPasswordInput,
  ChangeVaultPasswordResult,
  CreateCredentialInput,
  CreateCredentialResult,
  CreateManagerInput,
  CreateManagerResult,
  CredentialCodeResult,
  ListCredentialsResult,
  ManagerMutationResult,
  ReleaseGroupBindingResult,
  RemoveCredentialInput,
  RemoveCredentialResult,
  RenameCredentialInput,
  RenameManagerInput,
  RevealCredentialResult,
  UpdateCredentialResult,
  UpdateCredentialSecretInput,
  VaultCreateResult,
  VaultStatus,
  VaultUnlockResult
} from '../../shared/password-manager'

export type PasswordManagerRoute = { kind: 'local'; cwd: string } | { kind: 'unsupported' }

export interface PasswordManagerRouter {
  route(projectId: string): PasswordManagerRoute
}

/** True for the one failure every crypto-backed mutation can throw (a wrong or absent key). Any
 *  OTHER thrown error is a real bug and must keep propagating — swallowing it here would be
 *  exactly the "treat a read failure as an empty/safe result" mistake this whole module's sibling
 *  stores (secure-store.ts, vault-store.ts) go out of their way to avoid. */
function isLockedError(error: unknown): boolean {
  return error instanceof VaultCryptoError
}

export function registerPasswordManagerHandlers(
  platform: CorePlatform,
  router: PasswordManagerRouter,
  store: VaultStore = new VaultStore()
): void {
  const route = (projectId: string): PasswordManagerRoute => router.route(projectId)

  platform.handle(IPC.passwordManagerStatus, async (projectId: string): Promise<VaultStatus> => {
    const r = route(projectId)
    if (r.kind !== 'local') return { state: { kind: 'unsupported' }, managers: [] }
    const vault = await store.load(r.cwd)
    return statusOf(vault, store.isUnlocked(r.cwd))
  })

  platform.handle(
    IPC.passwordManagerCreateVault,
    async (projectId: string, password: string): Promise<VaultCreateResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      return store.mutate<VaultCreateResult>(r.cwd, (current) => {
        if (current) return { changed: false, result: { ok: false, error: 'already-initialized' } }
        const vault = createVault(password)
        return { changed: true, vault, result: { ok: true } }
      })
    }
  )

  platform.handle(
    IPC.passwordManagerUnlock,
    async (projectId: string, password: string): Promise<VaultUnlockResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      const outcome = await store.unlock(r.cwd, password)
      if (outcome === 'no-vault') return { ok: false, error: 'no-password-set' }
      if (outcome === 'wrong-password') return { ok: false, error: 'wrong-password' }
      return { ok: true }
    }
  )

  platform.handle(IPC.passwordManagerLock, async (projectId: string): Promise<void> => {
    const r = route(projectId)
    if (r.kind === 'local') store.lock(r.cwd)
  })

  platform.handle(
    IPC.passwordManagerChangePassword,
    async (projectId: string, input: ChangeVaultPasswordInput): Promise<ChangeVaultPasswordResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      const result = await store.mutate<ChangeVaultPasswordResult>(r.cwd, (current) => {
        if (!current) return { changed: false, result: { ok: false, error: 'uninitialized' } }
        const key = unlockVault(current, input.currentPassword)
        if (!key) return { changed: false, result: { ok: false, error: 'wrong-password' } }
        const vault = changeVaultPassword(current, key, input.newPassword)
        return { changed: true, vault, result: { ok: true } }
      })
      // A successful change re-derives the key under a NEW salt — re-cache it so this process is
      // not immediately reported as locked again right after the operation that just unlocked it.
      if (result.ok) await store.unlock(r.cwd, input.newPassword)
      return result
    }
  )

  platform.handle(
    IPC.passwordManagerCreateManager,
    async (projectId: string, input: CreateManagerInput): Promise<CreateManagerResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'This project has no local folder to keep a vault in.' }
      return store.mutate<CreateManagerResult>(r.cwd, (current) => {
        if (!current) return { changed: false, result: { ok: false, error: 'Set a project password first.' } }
        const { vault, manager } = createManager(current, input)
        const { credentials, ...meta } = manager
        return { changed: true, vault, result: { ok: true, manager: { ...meta, credentialCount: credentials.length } } }
      })
    }
  )

  platform.handle(
    IPC.passwordManagerRenameManager,
    async (projectId: string, input: RenameManagerInput): Promise<ManagerMutationResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      return store.mutate<ManagerMutationResult>(r.cwd, (current) => {
        if (!current) return { changed: false, result: { ok: false, error: 'not-found' } }
        const vault = renameManager(current, input.id, input.name)
        if (!vault) return { changed: false, result: { ok: false, error: 'not-found' } }
        return { changed: true, vault, result: { ok: true } }
      })
    }
  )

  platform.handle(
    IPC.passwordManagerBindManagerGroup,
    async (projectId: string, input: BindManagerGroupInput): Promise<ManagerMutationResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      return store.mutate<ManagerMutationResult>(r.cwd, (current) => {
        if (!current) return { changed: false, result: { ok: false, error: 'not-found' } }
        const vault = bindManagerToGroup(current, input.id, input.groupId)
        if (!vault) return { changed: false, result: { ok: false, error: 'not-found' } }
        return { changed: true, vault, result: { ok: true } }
      })
    }
  )

  // Every path that can drop a bound canvas group frame calls this — see vault.ts's
  // `releaseGroupBinding` doc comment for the chosen precedent (release the scope, never the
  // manager or its credentials).
  platform.handle(
    IPC.passwordManagerReleaseGroupBinding,
    async (projectId: string, groupId: string): Promise<ReleaseGroupBindingResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { releasedManagerIds: [] }
      return store.mutate<ReleaseGroupBindingResult>(r.cwd, (current) => {
        if (!current) return { changed: false, result: { releasedManagerIds: [] } }
        const { vault, releasedManagerIds } = releaseGroupBinding(current, groupId)
        if (!releasedManagerIds.length) return { changed: false, result: { releasedManagerIds } }
        return { changed: true, vault, result: { releasedManagerIds } }
      })
    }
  )

  platform.handle(
    IPC.passwordManagerDeleteManager,
    async (projectId: string, id: string): Promise<ManagerMutationResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      return store.mutate<ManagerMutationResult>(r.cwd, (current) => {
        if (!current) return { changed: false, result: { ok: false, error: 'not-found' } }
        const vault = deleteManager(current, id)
        if (!vault) return { changed: false, result: { ok: false, error: 'not-found' } }
        return { changed: true, vault, result: { ok: true } }
      })
    }
  )

  platform.handle(
    IPC.passwordManagerCreateCredential,
    async (projectId: string, input: CreateCredentialInput): Promise<CreateCredentialResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      const key = store.keyFor(r.cwd)
      if (!key) return { ok: false, error: 'locked' }
      return store.mutate<CreateCredentialResult>(r.cwd, (current) => {
        if (!current) return { changed: false, result: { ok: false, error: 'not-found' } }
        try {
          const created = createCredential(current, key, input)
          if (!created) return { changed: false, result: { ok: false, error: 'not-found' } }
          const { secret, ...summary } = created.credential
          return { changed: true, vault: created.vault, result: { ok: true, credential: summary } }
        } catch (error) {
          if (isLockedError(error)) return { changed: false, result: { ok: false, error: 'locked' } }
          throw error
        }
      })
    }
  )

  platform.handle(
    IPC.passwordManagerRenameCredential,
    async (projectId: string, input: RenameCredentialInput): Promise<ManagerMutationResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      return store.mutate<ManagerMutationResult>(r.cwd, (current) => {
        if (!current) return { changed: false, result: { ok: false, error: 'not-found' } }
        const vault = renameCredential(current, input.managerId, input.credentialId, input.label)
        if (!vault) return { changed: false, result: { ok: false, error: 'not-found' } }
        return { changed: true, vault, result: { ok: true } }
      })
    }
  )

  platform.handle(
    IPC.passwordManagerUpdateCredentialSecret,
    async (projectId: string, input: UpdateCredentialSecretInput): Promise<UpdateCredentialResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      const key = store.keyFor(r.cwd)
      if (!key) return { ok: false, error: 'locked' }
      return store.mutate<UpdateCredentialResult>(r.cwd, (current) => {
        if (!current) return { changed: false, result: { ok: false, error: 'not-found' } }
        try {
          const vault = updateCredentialSecret(current, key, input.managerId, input.credentialId, {
            username: input.username,
            password: input.password,
            totpSecretBase32: input.totpSecretBase32
          })
          if (!vault) return { changed: false, result: { ok: false, error: 'not-found' } }
          return { changed: true, vault, result: { ok: true } }
        } catch (error) {
          if (isLockedError(error)) return { changed: false, result: { ok: false, error: 'locked' } }
          throw error
        }
      })
    }
  )

  platform.handle(
    IPC.passwordManagerRemoveCredential,
    async (projectId: string, input: RemoveCredentialInput): Promise<RemoveCredentialResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      return store.mutate<RemoveCredentialResult>(r.cwd, (current) => {
        if (!current) return { changed: false, result: { ok: false, error: 'not-found' } }
        const vault = removeCredential(current, input.managerId, input.credentialId)
        if (!vault) return { changed: false, result: { ok: false, error: 'not-found' } }
        return { changed: true, vault, result: { ok: true } }
      })
    }
  )

  platform.handle(
    IPC.passwordManagerRevealCredential,
    async (projectId: string, managerId: string, credentialId: string): Promise<RevealCredentialResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      const vault = await store.load(r.cwd)
      if (!vault) return { ok: false, error: 'not-found' }
      const key = store.keyFor(r.cwd)
      if (!key) return { ok: false, error: 'locked' }
      try {
        const secret = revealCredential(vault, key, managerId, credentialId)
        if (!secret) return { ok: false, error: 'not-found' }
        return { ok: true, username: secret.username, password: secret.password, totpSecretBase32: secret.totpSecretBase32 }
      } catch (error) {
        if (isLockedError(error)) return { ok: false, error: 'locked' }
        throw error
      }
    }
  )

  platform.handle(
    IPC.passwordManagerCredentialCode,
    async (projectId: string, managerId: string, credentialId: string): Promise<CredentialCodeResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      const vault = await store.load(r.cwd)
      if (!vault) return { ok: false, error: 'not-found' }
      const key = store.keyFor(r.cwd)
      if (!key) return { ok: false, error: 'locked' }
      try {
        const outcome = credentialCode(vault, key, managerId, credentialId)
        if (outcome.kind === 'not-found') return { ok: false, error: 'not-found' }
        if (outcome.kind === 'no-totp') return { ok: false, error: 'no-totp' }
        return { ok: true, code: outcome.code }
      } catch (error) {
        if (isLockedError(error)) return { ok: false, error: 'locked' }
        throw error
      }
    }
  )

  // Non-secret metadata only, and therefore no key: the same rule `status` already follows for
  // manager names and counts. See `listCredentials` in vault.ts for why gating labels here would
  // protect nothing while leaving somebody unable to see what they own.
  platform.handle(
    IPC.passwordManagerListCredentials,
    async (projectId: string, managerId: string): Promise<ListCredentialsResult> => {
      const r = route(projectId)
      if (r.kind !== 'local') return { ok: false, error: 'unsupported' }
      const vault = await store.load(r.cwd)
      if (!vault) return { ok: false, error: 'uninitialized' }
      const credentials = listCredentials(vault, managerId)
      if (!credentials) return { ok: false, error: 'not-found' }
      return { ok: true, credentials }
    }
  )
}
