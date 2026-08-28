import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { renameAtomic, tempNameFor } from '../fs-atomic'
import type { CorePlatform } from '../platform'

export type CalendarCredential =
  | { kind: 'caldav'; username: string; password: string }
  | { kind: 'oauth'; accessToken: string; refreshToken: string | null; expiresAt: number; clientId: string; tokenUrl: string; scope: string }

const REF = /^[a-z0-9][a-z0-9-]{7,120}$/

function validCredential(value: unknown): value is CalendarCredential {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  if (raw.kind === 'caldav') return typeof raw.username === 'string' && raw.username.length <= 320 && typeof raw.password === 'string' && raw.password.length <= 4096
  return raw.kind === 'oauth' && typeof raw.accessToken === 'string' && raw.accessToken.length <= 16_384 &&
    (raw.refreshToken === null || (typeof raw.refreshToken === 'string' && raw.refreshToken.length <= 16_384)) &&
    typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt) && typeof raw.clientId === 'string' && raw.clientId.length <= 512 &&
    typeof raw.tokenUrl === 'string' && raw.tokenUrl.length <= 1000 && typeof raw.scope === 'string' && raw.scope.length <= 4000
}

/** Machine-local credential store. The project projection carries only its opaque references. */
export class CalendarCredentialVault {
  private readonly root: string

  constructor(private readonly platform: CorePlatform) {
    this.root = path.join(platform.userDataDir, 'calendar-credentials')
    if (!!platform.sealSecret !== !!platform.unsealSecret) throw new Error('Calendar credential sealing hooks must be supplied together.')
  }

  availability(): 'encrypted' | 'restricted-file' {
    return this.platform.sealSecret ? 'encrypted' : 'restricted-file'
  }

  private file(ref: string): string {
    if (!REF.test(ref)) throw new Error('Calendar credential reference is invalid.')
    return path.join(this.root, `${ref}.bin`)
  }

  async read(ref: string): Promise<CalendarCredential | null> {
    try {
      const storedBytes = await readFile(this.file(ref))
      const bytes = this.platform.unsealSecret
        ? this.platform.unsealSecret(storedBytes)
        : storedBytes
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown
      if (!validCredential(parsed)) throw new Error('Calendar credential has an unsupported shape.')
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async save(ref: string, credential: CalendarCredential): Promise<void> {
    if (!validCredential(credential)) throw new Error('Calendar credential is invalid.')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const destination = this.file(ref)
    const temporary = tempNameFor(destination)
    const clear = Buffer.from(JSON.stringify(credential), 'utf8')
    const bytes = this.platform.sealSecret ? this.platform.sealSecret(clear) : clear
    await writeFile(temporary, bytes, { mode: 0o600 })
    await renameAtomic(temporary, destination)
  }

  async clear(ref: string): Promise<void> {
    try { await unlink(this.file(ref)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}
