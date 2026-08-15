// Home Assistant long-lived access tokens, one per rule. Same at-rest contract as
// `agents/node-auth-secret.ts`: sealed via the platform's `sealSecret`/`unsealSecret` (Electron's
// Keychain-backed `safeStorage`) when the shell can seal, else a raw 0600 file — the Server
// Edition's documented "headless, no OS keychain" degrade (see `core/platform.ts`'s doc on those
// two hooks). A shell supplies BOTH hooks or NEITHER; `seals()` throws if exactly one is present,
// same as `node-auth-secret.ts`.
//
// Tokens are keyed by RULE id, not by host — a schedule can have several Home Assistant rules
// (different entities, potentially different instances), and nothing here assumes they share one
// instance or one token. Deleting a rule (or changing its source away from `'home-assistant'`)
// deletes its token file; see `pruneOrphanedTokens`, called from the service on every save.
import { promises as fs } from 'fs'
import path from 'path'
import { platform } from './platform'

const DIR = 'scheduled-settings-secrets'

function seals(): boolean {
  const p = platform()
  const hasSeal = typeof p.sealSecret === 'function'
  const hasUnseal = typeof p.unsealSecret === 'function'
  if (hasSeal !== hasUnseal) {
    throw new Error('CorePlatform must supply both sealSecret and unsealSecret, or neither')
  }
  return hasSeal
}

/** Rule ids are our own `uuid()`s, but a value that reaches a `path.join` is never trusted blindly
 *  — collapse to a filesystem-safe form first (defense in depth against a hand-edited
 *  scheduled-settings.json carrying a path-traversal id). */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 128) || 'rule'
}

function dir(): string {
  return path.join(platform().userDataDir, DIR)
}
function sealedFile(ruleId: string): string {
  return path.join(dir(), `${safeId(ruleId)}.json`)
}
function rawFile(ruleId: string): string {
  return path.join(dir(), `${safeId(ruleId)}.bin`)
}

type StoredToken = { version: 1; tokenEnc: string }

async function persistFile(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(tmp, data, { encoding: 'utf-8', mode: 0o600 })
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

/** Store (or, with `token: null`, clear) the Home Assistant access token for one rule. Never
 *  returns the token — the only way to read it back is `hasHomeAssistantToken`'s boolean, which is
 *  all the Settings UI ever needs (a status dot, not the secret itself). */
export async function setHomeAssistantToken(ruleId: string, token: string | null): Promise<void> {
  const sf = sealedFile(ruleId)
  const rf = rawFile(ruleId)
  if (token === null) {
    await fs.rm(sf, { force: true }).catch(() => {})
    await fs.rm(rf, { force: true }).catch(() => {})
    return
  }
  if (seals()) {
    const p = platform()
    const tokenEnc = p.sealSecret!(Buffer.from(token, 'utf8')).toString('base64')
    const body: StoredToken = { version: 1, tokenEnc }
    await persistFile(sf, `${JSON.stringify(body)}\n`)
    await fs.rm(rf, { force: true }).catch(() => {})
  } else {
    await persistFile(rf, token)
    await fs.rm(sf, { force: true }).catch(() => {})
  }
}

/** Main-process-only read (used by the service to build a request's Authorization header). Never
 *  exposed over IPC — see `scheduled-settings-service.ts`'s IPC surface, which offers only
 *  `setHomeAssistantToken`/`tokenStatus`, never a getter. */
export async function getHomeAssistantToken(ruleId: string): Promise<string | null> {
  try {
    if (seals()) {
      const raw = await fs.readFile(sealedFile(ruleId), 'utf8')
      const stored = JSON.parse(raw) as StoredToken
      if (stored?.version !== 1 || typeof stored.tokenEnc !== 'string') return null
      return platform().unsealSecret!(Buffer.from(stored.tokenEnc, 'base64')).toString('utf8')
    }
    return await fs.readFile(rawFile(ruleId), 'utf8')
  } catch {
    return null
  }
}

export async function hasHomeAssistantToken(ruleId: string): Promise<boolean> {
  return (await getHomeAssistantToken(ruleId)) !== null
}

/** Every rule id that currently has a stored token — for the Settings UI to render a status dot
 *  per rule without ever reading the token value itself. */
export async function homeAssistantTokenStatus(ruleIds: readonly string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {}
  await Promise.all(
    ruleIds.map(async (id) => {
      out[id] = await hasHomeAssistantToken(id)
    })
  )
  return out
}

/** Delete every stored token whose rule id is not in `liveRuleIds` — called after every save so a
 *  deleted rule (or one whose source changed away from `'home-assistant'`) doesn't leave an orphan
 *  credential sitting on disk forever. Best-effort: a listing failure (e.g. the directory was
 *  never created because no token has ever been saved) is not an error. */
export async function pruneOrphanedTokens(liveRuleIds: ReadonlySet<string> | readonly string[]): Promise<void> {
  const live = liveRuleIds instanceof Set ? liveRuleIds : new Set(liveRuleIds)
  let entries: string[]
  try {
    entries = await fs.readdir(dir())
  } catch {
    return
  }
  await Promise.all(
    entries.map(async (name) => {
      const m = /^(.+)\.(json|bin)$/.exec(name)
      if (!m) return
      const id = m[1]
      if (live.has(id)) return
      await fs.rm(path.join(dir(), name), { force: true }).catch(() => {})
    })
  )
}
