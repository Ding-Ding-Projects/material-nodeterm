// A small, generic "sealed-secret list" file, shared by the toy-lock and authenticator services
// (src/core/toylocks/). Each record splits into cleartext METADATA (safe to hand the renderer —
// names, timestamps, algorithm choices) and a sealed SECRET payload (a password hash, or a TOTP
// key) that only this module ever unseals.
//
// Sealing follows the exact convention core/agents/node-auth-secret.ts already established: use
// the shell's OS-vault seal/unseal when the platform offers one (Desktop: Electron `safeStorage`);
// otherwise store the payload as raw bytes in a 0600 file (the Server Edition's documented "no
// keychain here" configuration — see CorePlatform.sealSecret's doc comment). Either way the file
// itself is written 0600 via an atomic tmp+rename, so a reader never observes a half-written file
// and nothing but this process' own user can read it at rest.

import { promises as fs } from 'fs'
import path from 'path'
import { platform } from './platform'

export interface SealedEntry<TMeta> {
  meta: TMeta
  /** base64 of the sealed (or, on a no-seal shell, raw) JSON-encoded secret payload. */
  secretEnc: string
}

interface StoreFile<TMeta> {
  version: 1
  entries: SealedEntry<TMeta>[]
}

/** Whether this platform can seal secrets at rest. Throws if it supplies exactly one of the two
 *  hooks — a shell must supply BOTH or NEITHER (programming error), matching node-auth-secret.ts. */
function seals(): boolean {
  const p = platform()
  const hasSeal = typeof p.sealSecret === 'function'
  const hasUnseal = typeof p.unsealSecret === 'function'
  if (hasSeal !== hasUnseal) {
    throw new Error('CorePlatform must supply both sealSecret and unsealSecret, or neither')
  }
  return hasSeal
}

/** Write bytes atomically: unique tmp, 0600, rename into place, unlink the tmp in `finally` — a
 *  reader never sees a partial file, and two overlapping saves (renderer debounce + a shutdown
 *  flush) can never interleave their bytes. */
async function persistFile(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  try {
    await fs.writeFile(tmp, data, { mode: 0o600 })
    await fs.rename(tmp, file)
    await fs.chmod(file, 0o600)
  } finally {
    await fs.unlink(tmp).catch(() => {})
  }
}

export class SecureStore<TMeta extends { id: string }> {
  constructor(private readonly filename: string) {}

  private file(): string {
    return path.join(platform().userDataDir, this.filename)
  }

  /** Seal an arbitrary JSON-serializable secret payload (a password hash record, a TOTP secret +
   *  its algorithm/digits/period) into the base64 string a `SealedEntry.secretEnc` carries. */
  seal(payload: unknown): string {
    const json = Buffer.from(JSON.stringify(payload), 'utf8')
    if (seals()) return platform().sealSecret!(json).toString('base64')
    return json.toString('base64')
  }

  unseal<T>(secretEnc: string): T {
    const raw = Buffer.from(secretEnc, 'base64')
    const json = seals() ? platform().unsealSecret!(raw) : raw
    return JSON.parse(json.toString('utf8')) as T
  }

  /** Every record, metadata + sealed secret. A missing file is an empty list, not an error — a
   *  fresh install has neither locks nor authenticator entries yet. A corrupt/unreadable file also
   *  degrades to empty rather than throwing (nothing here should be able to crash a shell's boot);
   *  the file itself is left untouched so a human can still recover it by hand if it's salvageable. */
  async load(): Promise<SealedEntry<TMeta>[]> {
    try {
      const raw = await fs.readFile(this.file(), 'utf8')
      const parsed = JSON.parse(raw) as StoreFile<TMeta>
      if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return []
      return parsed.entries
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      return []
    }
  }

  async save(entries: SealedEntry<TMeta>[]): Promise<void> {
    const body: StoreFile<TMeta> = { version: 1, entries }
    await persistFile(this.file(), JSON.stringify(body, null, 2))
  }
}
