// Storage for user-pasted browser cookies, per provider.
//
// Some providers (MiniMax, opencode) publish no CLI credential on disk — their quota lives
// behind a web console session — so the only way to read it is to replay a cookie the user
// copies out of DevTools.
//
// These deliberately do NOT live in settings.json. That file is written with default
// permissions and is treated throughout the app as CONFIG — the `claudeAccounts` list sits
// there precisely because an account list is config, not a credential. A session cookie is the
// opposite: a live bearer credential for someone's account. It gets its own file at 0600 and
// never appears in a config blob that is world-readable, copied between machines, or pasted
// into a bug report.
//
// Generalized from the MiniMax-only version once opencode needed exactly the same thing; the
// file naming is unchanged (`<provider>-cookie.json`), so an already-stored MiniMax cookie is
// still found.
import { promises as fs } from 'fs'
import path from 'path'
import { platform } from '../platform'
import { clearAtomicTarget, renameAtomic, sweepStaleTempFiles, tempNameFor } from '../fs-atomic'

/** Owner read/write only. The whole reason these are separate files. */
const MODE = 0o600

/** Providers whose usage is read with a pasted browser cookie. */
export const COOKIE_PROVIDERS = ['minimax', 'opencode'] as const
export type CookieProvider = (typeof COOKIE_PROVIDERS)[number]

export class ProviderCookieClearError extends Error {
  readonly code = 'clear-incomplete' as const

  constructor() {
    super(
      'The provider cookie could not be fully cleared; canonical or temporary credential files remain or could not be inspected.'
    )
  }
}

export function isCookieProvider(v: unknown): v is CookieProvider {
  return typeof v === 'string' && (COOKIE_PROVIDERS as readonly string[]).includes(v)
}

function file(provider: CookieProvider): string {
  return path.join(platform().userDataDir, `${provider}-cookie.json`)
}

/** The stored cookie header, or null when this provider has not been configured. */
export async function readProviderCookie(provider: CookieProvider): Promise<string | null> {
  let raw: string
  try {
    raw = await fs.readFile(file(provider), 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const document = JSON.parse(raw) as Record<string, unknown>
  if (typeof document.cookie !== 'string' || !document.cookie.trim()) {
    throw new Error('The stored provider cookie is malformed.')
  }
  return document.cookie
}

/**
 * Store (or, with an empty value, clear) a provider's cookie. Written to a temp file first and
 * renamed, so a crash mid-write cannot leave a half-written credential behind — and the temp
 * file is created with the restricted mode too, since a rename preserves the source's mode.
 *
 * The temp name is unique per call: `usage:set-provider-cookie` is reachable from the preload
 * bridge and, on the Server Edition, from any WS client's frame (src/renderer/bridge/ws-bridge.ts
 * over the concurrent dispatch in src/server/ws.ts), with nothing serializing them. A shared temp
 * name lets one writer's rename publish the other's half-written cookie — or move the file out
 * from under it, so the loser's rename fails.
 */
export function writeProviderCookie(provider: CookieProvider, cookie: string): Promise<void> {
  // FIFO per provider (the WorkspaceStore.saveChain idiom): without it a clear's rm can run while
  // an earlier set sits between tmp-write and rename — the parked rename then resurrects the
  // credential the UI just reported cleared. Unique tmp names cannot fix that; only ordering can.
  // Each caller still sees only its own write's failure.
  const prev = writeChains.get(provider) ?? Promise.resolve()
  const run = prev.then(() => writeCookieNow(provider, cookie))
  writeChains.set(provider, run.catch(() => {}))
  return run
}

const writeChains = new Map<CookieProvider, Promise<unknown>>()

async function writeCookieNow(provider: CookieProvider, cookie: string): Promise<void> {
  const target = file(provider)
  if (!cookie.trim()) {
    // A fresh foreign temp may be a live writer and must survive. That makes this clear
    // incomplete, though: surface it instead of reporting that bearer bytes are gone.
    const result = await clearAtomicTarget(target)
    if (!result.cleared) throw new ProviderCookieClearError()
    return
  }
  await sweepStaleTempFiles(target)
  const tmp = tempNameFor(target)
  try {
    await fs.writeFile(tmp, JSON.stringify({ cookie }), { encoding: 'utf-8', mode: MODE })
    // Retries briefly on Windows if the destination is momentarily held open (AV/indexer/sync) — see fs-atomic.ts.
    await renameAtomic(tmp, target)
  } catch (e) {
    // A failed write MUST remove its own temp, because here a leaked temp IS a leaked cookie: a
    // unique name is never written again. A later cross-namespace-safe sweep deliberately keeps
    // pid-bearing temps, so this writer owns the only automatic cleanup. The error propagates.
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
  // Defense in depth on the PUBLISHED file: the temp is created 0600 and rename preserves the
  // mode, so this is a second lock on the door — cheap, and the one thing an attacker would need.
  await fs.chmod(target, MODE).catch(() => undefined)
}

/** Whether a cookie is stored — for the settings UI, which must never read the value back. */
export async function hasProviderCookie(provider: CookieProvider): Promise<boolean> {
  return (await readProviderCookie(provider)) !== null
}
