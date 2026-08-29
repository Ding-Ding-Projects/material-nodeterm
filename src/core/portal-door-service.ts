/**
 * Portal-door entry credentials, separate from the toy-lock service.
 *
 * A portal entry value is a real navigation admission check. Its metadata is kept in the
 * application-data directory and its verifier is sealed with the shell's OS-backed secret store
 * when available. Nothing from this store is written to project.json: only a door's enabled/mode
 * presence belongs in the portable projection. This service intentionally has no recovery game,
 * no ladder, and no relationship to toy-lock records.
 */

import { randomUUID, scryptSync, timingSafeEqual } from 'crypto'
import { platform } from './platform'
import { SecureStore, type SealedEntry } from './secure-store'
import { IPC } from '../shared/ipc'
import type {
  PortalDoorConfigureInput,
  PortalDoorConfigureResult,
  PortalDoorEntryRecord,
  PortalDoorEntryDuration,
  PortalDoorEntryMode,
  PortalDoorRelockInput,
  PortalDoorRemoveResult,
  PortalDoorStatus,
  PortalDoorStatusInput,
  PortalDoorVerifyInput,
  PortalDoorVerifyResult
} from '../shared/portal-door'

interface PortalDoorSecret {
  v: 1
  mode: PortalDoorEntryMode
  salt: string
  hash: string
  N: number
  r: number
  p: number
  keylen: number
}

const SCRYPT = { N: 131072, r: 8, p: 1, keylen: 32 } as const
const STORE_FILE = 'portal-door-entries.json'
const MAX_ID_BYTES = 256
const MAX_LABEL_BYTES = 1024
const MAX_PASSPHRASE_BYTES = 1024
const MIN_NUMERIC_CODE_LENGTH = 4
const MAX_NUMERIC_CODE_LENGTH = 12
const RATE_LIMIT_THRESHOLD = 3
const RATE_LIMIT_MAX_MS = 30_000

interface RateState {
  failures: number
  lastFailureAt: number
}

interface UnlockState {
  until: number
}

function isPortalSecret(value: unknown): value is PortalDoorSecret {
  if (!value || typeof value !== 'object') return false
  const secret = value as Partial<PortalDoorSecret>
  return (
    secret.v === 1 &&
    validMode(secret.mode) &&
    typeof secret.salt === 'string' &&
    typeof secret.hash === 'string' &&
    typeof secret.N === 'number' &&
    Number.isInteger(secret.N) &&
    typeof secret.r === 'number' &&
    Number.isInteger(secret.r) &&
    typeof secret.p === 'number' &&
    Number.isInteger(secret.p) &&
    typeof secret.keylen === 'number' &&
    Number.isInteger(secret.keylen) &&
    secret.N >= 16 &&
    secret.N <= SCRYPT.N * 2 &&
    (secret.N & (secret.N - 1)) === 0 &&
    secret.r >= 1 &&
    secret.r <= SCRYPT.r * 2 &&
    secret.p >= 1 &&
    secret.p <= SCRYPT.p * 2 &&
    secret.keylen >= 16 &&
    secret.keylen <= 64
  )
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || bytes(value) > MAX_ID_BYTES || [...value].some((c) => c < ' ' || c === '\u007f')) {
    throw new Error(`Portal door ${label} is invalid.`)
  }
  return value
}

function safeLabel(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || bytes(value) > MAX_LABEL_BYTES || [...value].some((c) => c < ' ' || c === '\u007f')) {
    throw new Error('Portal door label is invalid.')
  }
  return value.trim()
}

function validMode(value: unknown): value is PortalDoorEntryMode {
  return value === 'numeric-code' || value === 'passphrase'
}

function validDuration(value: unknown): value is PortalDoorEntryDuration {
  return value === 'session' || value === 'minutes' || value === 'until-close'
}

function validateDuration(duration: unknown, durationMinutes: unknown): void {
  if (!validDuration(duration)) throw new Error('Portal door duration is invalid.')
  if (duration === 'minutes' && (!Number.isInteger(durationMinutes) || Number(durationMinutes) < 1 || Number(durationMinutes) > 7 * 24 * 60)) {
    throw new Error('Portal door duration must be between 1 and 10080 minutes.')
  }
  if (duration !== 'minutes' && durationMinutes !== undefined) throw new Error('Portal door durationMinutes is only valid for a minutes duration.')
}

function validateSecret(mode: unknown, secret: unknown): asserts secret is string {
  if (!validMode(mode) || typeof secret !== 'string' || secret.length === 0 || bytes(secret) > MAX_PASSPHRASE_BYTES || [...secret].some((c) => c < ' ' || c === '\u007f')) {
    throw new Error('Portal door entry value is invalid.')
  }
  if (mode === 'numeric-code' && (!/^\d+$/.test(secret) || secret.length < MIN_NUMERIC_CODE_LENGTH || secret.length > MAX_NUMERIC_CODE_LENGTH)) {
    throw new Error('Portal numeric code must contain 4 to 12 digits.')
  }
}

function hashSecret(mode: PortalDoorEntryMode, value: string): PortalDoorSecret {
  const salt = Buffer.from(randomUUID().replaceAll('-', ''), 'hex')
  const hash = scryptSync(value, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 128 * SCRYPT.N * SCRYPT.r + 4 * 1024 * 1024
  })
  return { v: 1, mode, salt: salt.toString('base64'), hash: hash.toString('base64'), ...SCRYPT }
}

function matches(secret: PortalDoorSecret, value: string): boolean {
  if (!isPortalSecret(secret)) return false
  const salt = Buffer.from(secret.salt, 'base64')
  const stored = Buffer.from(secret.hash, 'base64')
  const computed = scryptSync(value, salt, secret.keylen, {
    N: secret.N,
    r: secret.r,
    p: secret.p,
    maxmem: 128 * secret.N * secret.r + 4 * 1024 * 1024
  })
  return computed.length === stored.length && timingSafeEqual(computed, stored)
}

function isMetadata(value: unknown): value is PortalDoorEntryRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PortalDoorEntryRecord>
  return (
    typeof item.id === 'string' &&
    typeof item.projectId === 'string' &&
    typeof item.doorId === 'string' &&
    typeof item.label === 'string' &&
    typeof item.enabled === 'boolean' &&
    validMode(item.mode) &&
    validDuration(item.duration) &&
    typeof item.lockedOnLaunch === 'boolean' &&
    typeof item.createdAt === 'number' &&
    typeof item.updatedAt === 'number' &&
    (item.duration !== 'minutes' || (Number.isInteger(item.durationMinutes) && Number(item.durationMinutes) >= 1))
  )
}

function assertEntry(entry: SealedEntry<PortalDoorEntryRecord>): void {
  if (!isMetadata(entry.meta)) throw new Error('Portal door entry store has malformed metadata.')
  safeIdentifier(entry.meta.projectId, 'project id')
  safeIdentifier(entry.meta.doorId, 'id')
  safeLabel(entry.meta.label)
  validateDuration(entry.meta.duration, entry.meta.durationMinutes)
  if (typeof entry.secretEnc !== 'string' || entry.secretEnc.length === 0) throw new Error('Portal door entry store has malformed secret data.')
}

function keyFor(projectId: string, doorId: string): string {
  return `${projectId}\u0000${doorId}`
}

function entryPublic(meta: PortalDoorEntryRecord): PortalDoorEntryRecord {
  return { ...meta }
}

export function startPortalDoorService(): { dispose(): void; mayEnter(projectId: string, doorId: string): Promise<boolean> } {
  const store = new SecureStore<PortalDoorEntryRecord>(STORE_FILE)
  const rates = new Map<string, RateState>()
  const unlocks = new Map<string, UnlockState>()

  const load = async (): Promise<SealedEntry<PortalDoorEntryRecord>[]> => {
    const entries = await store.load()
    entries.forEach(assertEntry)
    return entries
  }

  const find = (entries: SealedEntry<PortalDoorEntryRecord>[], projectId: string, doorId: string) =>
    entries.find((entry) => entry.meta.projectId === projectId && entry.meta.doorId === doorId)

  const clearExpired = (id: string): void => {
    const state = unlocks.get(id)
    if (state && state.until !== Infinity && state.until <= Date.now()) unlocks.delete(id)
  }

  const statusFor = (entry: SealedEntry<PortalDoorEntryRecord> | undefined): PortalDoorStatus => {
    if (!entry || !entry.meta.enabled) return { configured: false, unlocked: true }
    clearExpired(entry.meta.id)
    const state = unlocks.get(entry.meta.id)
    return {
      configured: true,
      mode: entry.meta.mode,
      unlocked: !!state,
      ...(state && state.until !== Infinity ? { unlockedUntil: state.until } : {})
    }
  }

  platform().handle(IPC.portalDoorList, async (projectId: string): Promise<PortalDoorEntryRecord[]> => {
    safeIdentifier(projectId, 'project id')
    return (await load()).filter((entry) => entry.meta.projectId === projectId).map((entry) => entryPublic(entry.meta))
  })

  platform().handle(IPC.portalDoorConfigure, async (input: PortalDoorConfigureInput): Promise<PortalDoorConfigureResult> => {
    if (!input || typeof input !== 'object') return { ok: false, error: 'Portal door configuration is invalid.' }
    try {
      const projectId = safeIdentifier(input.projectId, 'project id')
      const doorId = safeIdentifier(input.doorId, 'id')
      const label = safeLabel(input.label)
      const enabled = input.enabled ?? true
      if (typeof enabled !== 'boolean') throw new Error('Portal door enabled state is invalid.')
      validateSecret(input.mode, input.secret)
      validateDuration(input.duration, input.durationMinutes)
      if (typeof input.lockedOnLaunch !== 'boolean') throw new Error('Portal door lockedOnLaunch is invalid.')
      const result = await store.mutate<PortalDoorConfigureResult>((entries) => {
        const existing = entries.find((entry) => entry.meta.projectId === projectId && entry.meta.doorId === doorId)
        const now = Date.now()
        const meta: PortalDoorEntryRecord = existing
          ? { ...existing.meta, label, enabled, mode: input.mode, duration: input.duration, durationMinutes: input.durationMinutes, lockedOnLaunch: input.lockedOnLaunch, updatedAt: now }
          : { id: randomUUID(), projectId, doorId, label, enabled, mode: input.mode, duration: input.duration, durationMinutes: input.durationMinutes, lockedOnLaunch: input.lockedOnLaunch, createdAt: now, updatedAt: now }
        const secretEnc = store.seal(hashSecret(input.mode, input.secret))
        if (existing) Object.assign(existing, { meta, secretEnc })
        else entries.push({ meta, secretEnc })
        return { changed: true, result: { ok: true, record: entryPublic(meta) } }
      })
      if (result.ok) {
        const id = (result.record as PortalDoorEntryRecord).id
        rates.delete(keyFor(projectId, doorId))
        unlocks.delete(id)
      }
      return result
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Portal door configuration is invalid.' }
    }
  })

  platform().handle(IPC.portalDoorRemove, async (input: PortalDoorRelockInput): Promise<PortalDoorRemoveResult> => {
    const projectId = safeIdentifier(input.projectId, 'project id')
    const doorId = safeIdentifier(input.doorId, 'id')
    return store.mutate<PortalDoorRemoveResult>((entries) => {
      const index = entries.findIndex((entry) => entry.meta.projectId === projectId && entry.meta.doorId === doorId)
      if (index < 0) return { changed: false, result: { ok: false, error: 'not-found' } }
      const removed = entries[index]!
      entries.splice(index, 1)
      unlocks.delete(removed.meta.id)
      rates.delete(keyFor(projectId, doorId))
      return { changed: true, result: { ok: true } }
    })
  })

  platform().handle(IPC.portalDoorStatus, async (input: PortalDoorStatusInput): Promise<PortalDoorStatus> => {
    const projectId = safeIdentifier(input.projectId, 'project id')
    const doorId = safeIdentifier(input.doorId, 'id')
    return statusFor(find(await load(), projectId, doorId))
  })

  platform().handle(IPC.portalDoorVerify, async (input: PortalDoorVerifyInput): Promise<PortalDoorVerifyResult> => {
    const projectId = safeIdentifier(input.projectId, 'project id')
    const doorId = safeIdentifier(input.doorId, 'id')
    const now = Date.now()
    const rateKey = keyFor(projectId, doorId)
    const state = rates.get(rateKey)
    if (state && state.failures >= RATE_LIMIT_THRESHOLD) {
      const wait = Math.min(RATE_LIMIT_MAX_MS, 500 * 2 ** (state.failures - RATE_LIMIT_THRESHOLD))
      const retryAfterMs = Math.max(0, state.lastFailureAt + wait - now)
      if (retryAfterMs > 0) return { ok: false, retryAfterMs, reason: 'Too many entry attempts. Try again later.' }
    }
    const entry = find(await load(), projectId, doorId)
    if (!entry || !entry.meta.enabled) return { ok: true }
    if (typeof input.value !== 'string' || input.value.length === 0 || bytes(input.value) > MAX_PASSPHRASE_BYTES || [...input.value].some((c) => c < ' ' || c === '\u007f')) {
      return { ok: false, reason: 'That entry value did not match.' }
    }
    if (entry.meta.mode === 'numeric-code' && (!/^\d+$/.test(input.value) || input.value.length < MIN_NUMERIC_CODE_LENGTH || input.value.length > MAX_NUMERIC_CODE_LENGTH)) {
      const next = { failures: (state?.failures ?? 0) + 1, lastFailureAt: now }
      rates.set(rateKey, next)
      return { ok: false, reason: 'That entry value did not match.' }
    }
    const secret = store.unseal<PortalDoorSecret>(entry.secretEnc)
    if (!isPortalSecret(secret) || secret.mode !== entry.meta.mode) throw new Error('Portal door entry store has malformed verifier data.')
    if (!matches(secret, input.value)) {
      rates.set(rateKey, { failures: (state?.failures ?? 0) + 1, lastFailureAt: now })
      return { ok: false, reason: 'That entry value did not match.' }
    }
    rates.delete(rateKey)
    const until = entry.meta.duration === 'minutes' ? now + (entry.meta.durationMinutes ?? 1) * 60_000 : Infinity
    unlocks.set(entry.meta.id, { until })
    return { ok: true, ...(until !== Infinity ? { unlockedUntil: until } : {}) }
  })

  platform().handle(IPC.portalDoorRelock, async (input: PortalDoorRelockInput): Promise<void> => {
    const projectId = safeIdentifier(input.projectId, 'project id')
    const doorId = safeIdentifier(input.doorId, 'id')
    const entry = find(await load(), projectId, doorId)
    if (entry) unlocks.delete(entry.meta.id)
  })

  return {
    dispose(): void {
      rates.clear()
      unlocks.clear()
    },
    async mayEnter(projectId: string, doorId: string): Promise<boolean> {
      const p = safeIdentifier(projectId, 'project id')
      const d = safeIdentifier(doorId, 'id')
      return statusFor(find(await load(), p, d)).unlocked
    }
  }
}
