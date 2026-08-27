/** Host-owned local storage and verification for Multiverse door entries.
 *
 * The renderer submits a value only for one immediate configure or verify request. This service
 * seals it through SecureStore, keeps only safe metadata in the record, and returns a boolean
 * result rather than the stored value. It is intentionally unrelated to toy-lock storage. */

import { randomUUID, timingSafeEqual } from 'crypto'
import { IPC } from '../shared/ipc'
import type { UniverseDoorEntryApi } from '../shared/types'
import { platform } from './platform'
import { SecureStore, type SealedEntry } from './secure-store'
import {
  createLocalUniverseDoorCredentialBinding,
  createPortableUniverseDoorEntry,
  validateUniverseDoorEntrySubmission,
  type PortableUniverseDoorEntryV3,
  type UniverseDoorEntryMethod
} from './universe-door-entry'

interface DoorEntryMeta {
  id: string
  doorId: string
  method: UniverseDoorEntryMethod
  numericCodeDigits?: number
  passphraseMinLength?: number
  credentialKey: string
}

interface DoorEntrySecret {
  version: 1
  value: string
}

function entryFor(
  meta: DoorEntryMeta
): PortableUniverseDoorEntryV3 {
  return createPortableUniverseDoorEntry({
    doorId: meta.doorId,
    methods: [meta.method],
    defaultMethod: meta.method,
    ...(meta.numericCodeDigits === undefined ? {} : { numericCodeDigits: meta.numericCodeDigits }),
    ...(meta.passphraseMinLength === undefined ? {} : { passphraseMinLength: meta.passphraseMinLength })
  })
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function startUniverseDoorEntryService(): { dispose(): void } {
  const store = new SecureStore<DoorEntryMeta>('universe-door-entries.json')

  const configure = async (
    input: Parameters<UniverseDoorEntryApi['configure']>[0]
  ): Promise<Awaited<ReturnType<UniverseDoorEntryApi['configure']>>> => {
    try {
      const method = input.method
      const policy = createPortableUniverseDoorEntry({
        doorId: input.doorId,
        methods: [method],
        defaultMethod: method,
        ...(method === 'numeric-code' ? { numericCodeDigits: input.numericCodeDigits ?? 6 } : {}),
        ...(method === 'passphrase' ? { passphraseMinLength: input.passphraseMinLength ?? 12 } : {})
      })
      const validation = validateUniverseDoorEntrySubmission(policy, { method, value: input.value })
      if (!validation.valid) return { ok: false, error: validation.message }
      const binding = createLocalUniverseDoorCredentialBinding(policy, method)
      const meta: DoorEntryMeta = {
        id: randomUUID(),
        doorId: policy.doorId,
        method,
        ...(policy.numericCodeDigits === undefined ? {} : { numericCodeDigits: policy.numericCodeDigits }),
        ...(policy.passphraseMinLength === undefined ? {} : { passphraseMinLength: policy.passphraseMinLength }),
        credentialKey: binding.credentialKey
      }
      await store.mutate<void>((entries) => {
        const retained = entries.filter((entry) => !(entry.meta.doorId === meta.doorId && entry.meta.method === meta.method))
        retained.push({ meta, secretEnc: store.seal({ version: 1, value: validation.submission.value } satisfies DoorEntrySecret) })
        entries.splice(0, entries.length, ...retained)
        return { changed: true, result: undefined }
      })
      return { ok: true, credentialKey: binding.credentialKey }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'The door entry could not be stored.' }
    }
  }

  const verify = async (
    input: Parameters<UniverseDoorEntryApi['verify']>[0]
  ): Promise<Awaited<ReturnType<UniverseDoorEntryApi['verify']>>> => {
    try {
      const entries = await store.load()
      const entry = entries.find((candidate) => candidate.meta.doorId === input.doorId && candidate.meta.method === input.method)
      if (!entry) return { verified: false, reason: 'This door has no matching credential on this computer.' }
      const policy = entryFor(entry.meta)
      const validation = validateUniverseDoorEntrySubmission(policy, input)
      if (!validation.valid) return { verified: false, reason: validation.message }
      const secret = store.unseal<DoorEntrySecret>(entry.secretEnc)
      if (!secret || secret.version !== 1 || typeof secret.value !== 'string') {
        return { verified: false, reason: 'The local door credential is unavailable.' }
      }
      return sameSecret(secret.value, validation.submission.value)
        ? { verified: true }
        : { verified: false, reason: 'The supplied entry value did not match this door.' }
    } catch {
      return { verified: false, reason: 'The local door credential is unavailable.' }
    }
  }

  const remove = async (doorId: string): Promise<void> => {
    await store.mutate<void>((entries) => {
      const retained = entries.filter((entry) => entry.meta.doorId !== doorId)
      if (retained.length === entries.length) return { changed: false, result: undefined }
      entries.splice(0, entries.length, ...retained)
      return { changed: true, result: undefined }
    })
  }

  platform().handle(IPC.universeDoorEntryConfigure, configure)
  platform().handle(IPC.universeDoorEntryVerify, verify)
  platform().handle(IPC.universeDoorEntryRemove, remove)

  return { dispose: (): void => undefined }
}

