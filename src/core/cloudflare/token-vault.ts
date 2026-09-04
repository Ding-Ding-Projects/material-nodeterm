import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renameAtomic, tempNameFor } from '../fs-atomic'
import type { CorePlatform } from '../platform'
import type { CloudflareTokenStatus } from '../../shared/cloudflare'

type StoredToken = { version: 1; kind: 'sealed' | 'restricted-file'; value: string }

const TOKEN_MAX = 512
const TOKEN_RE = /^[A-Za-z0-9_./+=:-]{10,512}$/

function validToken(value: string): boolean { return typeof value === 'string' && value.length <= TOKEN_MAX && TOKEN_RE.test(value) }

/** Local Cloudflare API-token vault. The token is never returned through the renderer status API.
 * Desktop shells provide safeStorage through CorePlatform; a headless shell may use a 0600 file,
 * which is explicitly reported as restricted-file and never copied into a project projection. */
export class CloudflareTokenVault {
  private readonly file: string
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly platform: CorePlatform) { this.file = join(platform.userDataDir, 'cloudflare', 'token.json') }

  status(): Promise<CloudflareTokenStatus> { return this.read().then((doc) => ({ present: !!doc, storage: this.storageKind() })) }

  save(token: string): Promise<CloudflareTokenStatus> { return this.serial(() => this.saveNow(token)) }
  clear(): Promise<CloudflareTokenStatus> { return this.serial(async () => { try { const fs = await import('node:fs/promises'); await fs.rm(this.file, { force: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error } return { present: false, storage: this.storageKind() } }) }

  async readSecret(): Promise<string | null> {
    const doc = await this.read()
    if (!doc) return null
    try {
      const bytes = Buffer.from(doc.value, 'base64')
      const token = doc.kind === 'sealed' && this.platform.unsealSecret ? this.platform.unsealSecret(bytes).toString('utf8') : bytes.toString('utf8')
      if (!validToken(token)) throw new Error('invalid stored token')
      return token
    } catch { throw new Error('The stored Cloudflare token could not be read.') }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> { const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next }
  private storageKind(): CloudflareTokenStatus['storage'] { return this.platform.sealSecret && this.platform.unsealSecret ? 'encrypted' : 'restricted-file' }
  private async saveNow(token: string): Promise<CloudflareTokenStatus> {
    if (!validToken(token)) throw new Error('Cloudflare API token is invalid or too long.')
    await mkdir(join(this.platform.userDataDir, 'cloudflare'), { recursive: true })
    const bytes = this.platform.sealSecret && this.platform.unsealSecret ? this.platform.sealSecret(Buffer.from(token, 'utf8')) : Buffer.from(token, 'utf8')
    const tmp = tempNameFor(this.file)
    const fs = await import('node:fs/promises')
    await fs.writeFile(tmp, JSON.stringify({ version: 1, kind: this.storageKind() === 'encrypted' ? 'sealed' : 'restricted-file', value: bytes.toString('base64') } satisfies StoredToken), { mode: 0o600 })
    await renameAtomic(tmp, this.file)
    return { present: true, storage: this.storageKind() }
  }
  private async read(): Promise<StoredToken | null> {
    try {
      const raw = await readFile(this.file, 'utf8'); const parsed = JSON.parse(raw) as Partial<StoredToken>
      if (parsed.version !== 1 || (parsed.kind !== 'sealed' && parsed.kind !== 'restricted-file') || typeof parsed.value !== 'string' || parsed.value.length > TOKEN_MAX * 2) throw new Error('invalid token document')
      return parsed as StoredToken
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('The Cloudflare token vault could not be read.') }
  }
}
