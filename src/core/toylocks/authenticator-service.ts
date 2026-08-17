// The built-in authenticator's CRUD + live-code surface. Registered by BOTH shells, same pattern
// as toylock-service.ts. Secrets are sealed at rest (Desktop: Electron safeStorage; Server
// Edition: raw 0600 bytes — see core/secure-store.ts) and only ever leave this module in three
// deliberate, explicit places: the one-time reveal action, the gated bulk secrets export, and the
// live `code`/`codes` computation (which hands back a computed 6–8 digit CODE, never the secret
// that produced it).

import { randomUUID } from 'crypto'
import { platform } from '../platform'
import { IPC } from '../../shared/ipc'
import { SecureStore } from '../secure-store'
import { base32Decode, buildOtpAuthUri, parseOtpAuthUri, totp, totpCounterForTime } from './totp'
import type {
  AuthenticatorAddManualInput,
  AuthenticatorAddResult,
  AuthenticatorCode,
  AuthenticatorEntry,
  AuthenticatorExportEntry,
  AuthenticatorExportInput,
  AuthenticatorExportResult,
  AuthenticatorRenameInput,
  AuthenticatorRevealResult
} from '../../shared/authenticator'

interface StoredSecret {
  v: 1
  secretBase32: string
}

/** How far the process clock would have to be from "correct" before a code it computes is at real
 *  risk of falling outside the ±1-period tolerance most verifiers (including this app's own
 *  toylock TOTP check) allow. Purely a courtesy heuristic — there is no oracle for "the real time"
 *  available here, so this only catches a clock that is obviously, grossly wrong (a stopped RTC, a
 *  VM that never synced), not genuine small drift. */
const GROSS_CLOCK_SKEW_HINT_S = 120

type AuthenticatorStore = Pick<
  SecureStore<AuthenticatorEntry>,
  'load' | 'save' | 'seal' | 'unseal'
>

export function startAuthenticatorService(
  store: AuthenticatorStore = new SecureStore<AuthenticatorEntry>('authenticator.json')
): { dispose(): void } {
  const codeFor = (secretBase32: string, entry: AuthenticatorEntry): AuthenticatorCode => {
    const secretBytes = base32Decode(secretBase32)
    const nowS = Math.floor(Date.now() / 1000)
    const counter = totpCounterForTime(nowS, entry.period)
    const code = totp(secretBytes, {
      epochSeconds: nowS,
      period: entry.period,
      digits: entry.digits,
      algorithm: entry.algorithm
    })
    const next = totp(secretBytes, {
      epochSeconds: nowS + entry.period,
      period: entry.period,
      digits: entry.digits,
      algorithm: entry.algorithm
    })
    // A crude "does the clock look sane" check: if the wall clock reports a time before this
    // process itself started (a stopped/rolled-back clock) that's a strong, cheap signal worth
    // surfacing. We don't have a real time-authority to diff against, so this stays a hint, not a
    // verdict — see the constant's doc comment above.
    const bootS = Math.floor((Date.now() - process.uptime() * 1000) / 1000)
    const clockWarning =
      nowS < bootS - GROSS_CLOCK_SKEW_HINT_S
        ? "This computer's clock looks wrong — codes may be refused until it's fixed."
        : undefined
    return {
      code,
      next,
      periodStart: counter * entry.period,
      period: entry.period,
      digits: entry.digits,
      clockWarning
    }
  }

  platform().handle(IPC.authenticatorList, async (): Promise<AuthenticatorEntry[]> => {
    const entries = await store.load()
    return entries.map((e) => e.meta).sort((a, b) => a.issuer.localeCompare(b.issuer) || a.account.localeCompare(b.account))
  })

  platform().handle(
    IPC.authenticatorAddManual,
    async (input: AuthenticatorAddManualInput): Promise<AuthenticatorAddResult> => {
      const secretBase32 = input.secretBase32.toUpperCase().replace(/[^A-Z2-7]/g, '')
      if (!secretBase32) return { ok: false, error: 'That secret is not valid base32.' }
      if (!input.issuer.trim() && !input.account.trim()) {
        return { ok: false, error: 'Give this entry an issuer or an account name.' }
      }
      const now = Date.now()
      const meta: AuthenticatorEntry = {
        id: randomUUID(),
        issuer: input.issuer.trim() || 'Account',
        account: input.account.trim() || input.issuer.trim() || 'Account',
        algorithm: input.algorithm,
        digits: input.digits >= 6 && input.digits <= 8 ? input.digits : 6,
        period: input.period > 0 ? input.period : 30,
        createdAt: now,
        updatedAt: now
      }
      return store.mutate<AuthenticatorAddResult>((entries) => {
        const secretEnc = store.seal({ v: 1, secretBase32 } satisfies StoredSecret)
        entries.push({ meta, secretEnc })
        return { changed: true, result: { ok: true, entry: meta } }
      })
    }
  )

  platform().handle(
    IPC.authenticatorAddUri,
    async (uri: string): Promise<AuthenticatorAddResult> => {
      const parsed = parseOtpAuthUri(uri)
      if (!parsed) {
        return {
          ok: false,
          error: 'Not a valid otpauth://totp/ URI (HOTP and other schemes are not supported).'
        }
      }
      const now = Date.now()
      const meta: AuthenticatorEntry = {
        id: randomUUID(),
        issuer: parsed.issuer,
        account: parsed.account,
        algorithm: parsed.algorithm,
        digits: parsed.digits,
        period: parsed.period,
        createdAt: now,
        updatedAt: now
      }
      return store.mutate<AuthenticatorAddResult>((entries) => {
        const secretEnc = store.seal({ v: 1, secretBase32: parsed.secretBase32 } satisfies StoredSecret)
        entries.push({ meta, secretEnc })
        return { changed: true, result: { ok: true, entry: meta } }
      })
    }
  )

  platform().handle(
    IPC.authenticatorRename,
    async (input: AuthenticatorRenameInput): Promise<AuthenticatorEntry | null> => {
      return store.mutate<AuthenticatorEntry | null>((entries) => {
        const entry = entries.find((e) => e.meta.id === input.id)
        if (!entry) return { changed: false, result: null }
        if (input.issuer !== undefined) entry.meta.issuer = input.issuer.trim() || entry.meta.issuer
        if (input.account !== undefined) entry.meta.account = input.account.trim() || entry.meta.account
        entry.meta.updatedAt = Date.now()
        return { changed: true, result: entry.meta }
      })
    }
  )

  platform().handle(IPC.authenticatorRemove, async (id: string): Promise<void> => {
    await store.mutate<void>((entries) => {
      const next = entries.filter((e) => e.meta.id !== id)
      if (next.length === entries.length) return { changed: false, result: undefined }
      entries.splice(0, entries.length, ...next)
      return { changed: true, result: undefined }
    })
  })

  platform().handle(
    IPC.authenticatorCode,
    async (id: string): Promise<AuthenticatorCode | null> => {
      const entries = await store.load()
      const entry = entries.find((e) => e.meta.id === id)
      if (!entry) return null
      const secret = store.unseal<StoredSecret>(entry.secretEnc)
      return codeFor(secret.secretBase32, entry.meta)
    }
  )

  platform().handle(
    IPC.authenticatorCodes,
    async (ids: string[]): Promise<Record<string, AuthenticatorCode>> => {
      const entries = await store.load()
      const wanted = new Set(ids)
      const out: Record<string, AuthenticatorCode> = {}
      for (const entry of entries) {
        if (!wanted.has(entry.meta.id)) continue
        const secret = store.unseal<StoredSecret>(entry.secretEnc)
        out[entry.meta.id] = codeFor(secret.secretBase32, entry.meta)
      }
      return out
    }
  )

  platform().handle(
    IPC.authenticatorReveal,
    async (id: string): Promise<AuthenticatorRevealResult> => {
      const entries = await store.load()
      const entry = entries.find((e) => e.meta.id === id)
      if (!entry) return { ok: false, error: 'This entry no longer exists.' }
      const secret = store.unseal<StoredSecret>(entry.secretEnc)
      const otpauthUri = buildOtpAuthUri({
        issuer: entry.meta.issuer,
        account: entry.meta.account,
        secretBase32: secret.secretBase32,
        algorithm: entry.meta.algorithm,
        digits: entry.meta.digits,
        period: entry.meta.period
      })
      return { ok: true, secretBase32: secret.secretBase32, otpauthUri }
    }
  )

  // The one place a secret leaves in bulk. The gate is enforced by the CALLER (a two-key
  // super-confirmation UI — see AuthenticatorPanel.tsx); `confirmed` is a speed bump on the wire
  // matching the spirit of the rest of this feature, not a real access-control boundary — this is
  // an Electron/local-server app where the renderer and the core already share a trust boundary.
  platform().handle(
    IPC.authenticatorExportSecrets,
    async (input: AuthenticatorExportInput): Promise<AuthenticatorExportResult> => {
      if (!input?.confirmed) return { ok: false, error: 'Export was not confirmed.' }
      const entries = await store.load()
      const wanted = new Set(input.ids)
      const out: AuthenticatorExportEntry[] = []
      for (const entry of entries) {
        if (wanted.size && !wanted.has(entry.meta.id)) continue
        const secret = store.unseal<StoredSecret>(entry.secretEnc)
        out.push({
          issuer: entry.meta.issuer,
          account: entry.meta.account,
          otpauthUri: buildOtpAuthUri({
            issuer: entry.meta.issuer,
            account: entry.meta.account,
            secretBase32: secret.secretBase32,
            algorithm: entry.meta.algorithm,
            digits: entry.meta.digits,
            period: entry.meta.period
          })
        })
      }
      return { ok: true, entries: out }
    }
  )

  return { dispose: (): void => {} }
}
