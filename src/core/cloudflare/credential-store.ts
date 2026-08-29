import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { renameAtomic, tempNameFor } from '../fs-atomic'

const FILE = 'cloudflare-api-token.json'

export interface CloudflareSecretCodec {
  seal(value: string): Buffer
  unseal(value: Buffer): string
}

type StoredToken =
  | { version: 1; kind: 'sealed'; value: string }
  | { version: 1; kind: 'restricted-file'; token: string }

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 512 && /^[^\u0000-\u001f\u007f\s]+$/.test(value)
}

/** Token storage for the control plane. Callers can only ask whether a token is present. */
export class CloudflareCredentialStore {
  constructor(private readonly userDataDir: string, private readonly codec?: CloudflareSecretCodec) {}

  private get path(): string { return join(this.userDataDir, FILE) }

  async hasToken(): Promise<boolean> {
    return (await this.read()) !== null
  }

  async readForRequest(): Promise<string | null> {
    const stored = await this.read()
    if (!stored) return null
    if (stored.kind === 'restricted-file') return stored.token
    if (!this.codec) throw new Error('Cloudflare credential storage is locked.')
    const token = this.codec.unseal(Buffer.from(stored.value, 'base64'))
    if (!validToken(token)) throw new Error('The stored Cloudflare credential is invalid.')
    return token
  }

  async save(token: string): Promise<void> {
    if (!validToken(token)) throw new Error('Cloudflare API token is invalid or incomplete.')
    const document: StoredToken = this.codec
      ? { version: 1, kind: 'sealed', value: this.codec.seal(token).toString('base64') }
      : { version: 1, kind: 'restricted-file', token }
    await fs.mkdir(this.userDataDir, { recursive: true })
    const temporary = tempNameFor(this.path)
    try {
      await fs.writeFile(temporary, JSON.stringify(document), { encoding: 'utf8', mode: 0o600 })
      await fs.chmod(temporary, 0o600)
      await renameAtomic(temporary, this.path)
      await fs.chmod(this.path, 0o600)
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {})
    }
  }

  async clear(): Promise<void> {
    await fs.rm(this.path, { force: true })
  }

  private async read(): Promise<StoredToken | null> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.path, 'utf8'))
      if (!parsed || typeof parsed !== 'object') return null
      const value = parsed as Partial<StoredToken>
      if (value.version !== 1) return null
      if (value.kind === 'restricted-file' && validToken(value.token)) return { version: 1, kind: 'restricted-file', token: value.token }
      if (value.kind === 'sealed' && typeof value.value === 'string' && value.value.length > 0) return { version: 1, kind: 'sealed', value: value.value }
      return null
    } catch {
      return null
    }
  }
}
