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
import { clearAtomicTarget, renameAtomic, sweepStaleTempFiles, tempNameFor } from './fs-atomic'

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

// renderer/lib/uuid.ts generates lowercase RFC 4122 v4 ids. Enforce that exact alphabet and
// version at the filesystem boundary: lossy replacement made distinct hand-edited ids such as
// "a/b" and "a_b" share one credential, and case folding aliases names on Windows.
const RULE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const UUID_V4_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
// Canonical files plus the exact temp shapes emitted by current and historical atomic writers.
// Keeping this in step with fs-atomic's recognizer lets prune discover a temp-only orphan without
// treating an arbitrary filename lookalike as deletion authority.
const TOKEN_ARTIFACT_RE = new RegExp(
  `^(.+)\\.(json|bin)(?:\\.tmp|\\.\\d+\\.\\d+(?:\\.${UUID_V4_SOURCE})?\\.tmp)?$`
)

function validRuleId(id: string): boolean {
  return RULE_ID_RE.test(id)
}

function dir(): string {
  return path.join(platform().userDataDir, DIR)
}
function sealedFile(ruleId: string): string {
  return path.join(dir(), `${ruleId}.json`)
}
function rawFile(ruleId: string): string {
  return path.join(dir(), `${ruleId}.bin`)
}

type StoredToken = { version: 1; tokenEnc: string }

// Token mutations are infrequent, while pruning is directory-wide. One FIFO therefore gives the
// whole module a single order: a prune cannot miss a set parked before rename, and an older prune
// cannot wake after a newer set and delete it. A per-rule queue cannot provide either guarantee
// without an additional exclusive prune barrier. The recovered tail keeps a failed mutation from
// poisoning later calls; the identity check releases completed closures once the queue is idle.
const idleMutation = Promise.resolve()
let mutationTail: Promise<void> = idleMutation

function serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = mutationTail.then(mutation)
  const recovered = run.then(
    () => undefined,
    () => undefined
  )
  mutationTail = recovered
  void recovered.then(() => {
    if (mutationTail === recovered) mutationTail = idleMutation
  })
  return run
}

export class ScheduledSettingsSecretError extends Error {
  readonly code = 'clear-incomplete' as const

  constructor() {
    super(
      'The Home Assistant token could not be fully cleared; canonical or temporary credential files remain or could not be inspected.'
    )
  }
}

export class InvalidScheduledSettingsRuleIdError extends Error {
  readonly code = 'invalid-rule-id' as const

  constructor() {
    super('The scheduled-settings rule id is invalid.')
  }
}

async function persistFile(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await sweepStaleTempFiles(file)
  const tmp = tempNameFor(file)
  try {
    await fs.writeFile(tmp, data, { encoding: 'utf-8', mode: 0o600 })
    // Retries briefly on Windows if the destination is momentarily held open (AV/indexer/sync) — see fs-atomic.ts.
    await renameAtomic(tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

/** Store (or, with `token: null`, clear) the Home Assistant access token for one rule. Never
 *  returns the token — the only way to read it back is `hasHomeAssistantToken`'s boolean, which is
 *  all the Settings UI ever needs (a status dot, not the secret itself). */
export async function setHomeAssistantToken(ruleId: string, token: string | null): Promise<void> {
  if (!validRuleId(ruleId)) throw new InvalidScheduledSettingsRuleIdError()
  const sf = sealedFile(ruleId)
  const rf = rawFile(ruleId)
  // Resolve the platform-dependent representation at invocation time. A queued call must not
  // follow a later test/server lifecycle's initPlatform() into a different data directory or
  // switch between sealed/raw formats while it waits its turn.
  const shouldSeal = token !== null && seals()
  const sealedBody = shouldSeal
    ? `${JSON.stringify({
        version: 1,
        tokenEnc: platform().sealSecret!(Buffer.from(token, 'utf8')).toString('base64')
      } satisfies StoredToken)}\n`
    : null

  return serializeMutation(async () => {
    if (token === null) {
      const [sealed, raw] = await Promise.all([clearAtomicTarget(sf), clearAtomicTarget(rf)])
      if (!sealed.cleared || !raw.cleared) throw new ScheduledSettingsSecretError()
      return
    }
    if (shouldSeal) {
      await persistFile(sf, sealedBody!)
      const alternate = await clearAtomicTarget(rf)
      if (!alternate.cleared) throw new ScheduledSettingsSecretError()
    } else {
      await persistFile(rf, token)
      const alternate = await clearAtomicTarget(sf)
      if (!alternate.cleared) throw new ScheduledSettingsSecretError()
    }
  })
}

/** Main-process-only read (used by the service to build a request's Authorization header). Never
 *  exposed over IPC — see `scheduled-settings-service.ts`'s IPC surface, which offers only
 *  `setHomeAssistantToken`/`tokenStatus`, never a getter. */
export async function getHomeAssistantToken(ruleId: string): Promise<string | null> {
  if (!validRuleId(ruleId)) return null
  const useSealed = seals()
  const preferred = useSealed ? sealedFile(ruleId) : rawFile(ruleId)
  const alternate = useSealed ? rawFile(ruleId) : sealedFile(ruleId)
  let raw: string
  try {
    raw = await fs.readFile(preferred, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      await fs.lstat(alternate)
    } catch (alternateError) {
      if ((alternateError as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw alternateError
    }
    // A bearer exists, but not in the representation this platform can safely consume. Reporting
    // null would hide Clear and turn “could not read” into “absent”; status callers surface unknown.
    throw new Error('The stored Home Assistant token is in an unavailable format.')
  }
  if (!useSealed) {
    if (!raw.trim()) throw new Error('The stored Home Assistant token is malformed.')
    return raw
  }
  const stored = JSON.parse(raw) as StoredToken
  if (stored?.version !== 1 || typeof stored.tokenEnc !== 'string') {
    throw new Error('The stored Home Assistant token is malformed.')
  }
  return platform().unsealSecret!(Buffer.from(stored.tokenEnc, 'base64')).toString('utf8')
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
 *  credential sitting on disk forever. ENOENT is a genuinely empty store; an unreadable directory
 *  or a retained canonical/temp artifact is an incomplete credential clear and must reach the UI. */
export async function pruneOrphanedTokens(liveRuleIds: ReadonlySet<string> | readonly string[]): Promise<void> {
  const secretDir = dir()
  // Invalid hand-edited ids are not credential identities. Excluding them makes any residue from
  // the former lossy safeId scheme collectible instead of letting an invalid rule protect it.
  const live = new Set([...liveRuleIds].filter(validRuleId))

  return serializeMutation(async () => {
    let entries: string[]
    try {
      entries = await fs.readdir(secretDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new ScheduledSettingsSecretError()
    }
    const orphanIds = new Set<string>()
    for (const name of entries) {
      const match = TOKEN_ARTIFACT_RE.exec(name)
      if (match && !live.has(match[1])) orphanIds.add(match[1])
    }
    let incomplete = false
    await Promise.all(
      [...orphanIds].flatMap((id) =>
        [path.join(secretDir, `${id}.json`), path.join(secretDir, `${id}.bin`)].map(async (file) => {
          const result = await clearAtomicTarget(file)
          if (!result.cleared) incomplete = true
        })
      )
    )
    if (incomplete) throw new ScheduledSettingsSecretError()
  })
}
