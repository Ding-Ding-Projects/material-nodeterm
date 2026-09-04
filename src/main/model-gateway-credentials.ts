import { promises as fs } from 'node:fs'
import path from 'node:path'
import { MODEL_GATEWAY_SECRET_REF, modelGatewayCredentialKind, type ModelGatewayCredentialStatus } from '../shared/agents/model-gateway'
import { renameAtomic, tempNameFor } from '../core/fs-atomic'

export interface ModelGatewaySafeStorage {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

type StoredDocument =
  | { version: 1; kind: 'safe-storage'; value: string }

/** Local write-only credential facade used by model discovery and agent launch assembly. */
export class ModelGatewayCredentialService {
  private value: string | null = null

  constructor(
    private readonly userDataDir: string,
    private readonly safeStorage: ModelGatewaySafeStorage
  ) {}

  async init(): Promise<void> {
    this.value = await this.readFile()
  }

  readForHost(): string | null {
    return this.value
  }

  status(): ModelGatewayCredentialStatus {
    return {
      hasStoredKey: this.value !== null,
      storage: this.storageKind()
    }
  }

  async save(apiKey: string): Promise<ModelGatewayCredentialStatus> {
    const value = apiKey.trim()
    if (!value || value.length > 4096 || /[\r\n\0]/.test(value)) throw new Error('invalid-api-key')
    if (!this.canEncrypt()) throw new Error('gateway-secret-storage-unavailable')
    const document: StoredDocument = {
      version: 1,
      kind: 'safe-storage',
      value: this.safeStorage.encryptString(value).toString('base64')
    }
    await this.writeFile(document)
    this.value = value
    return this.status()
  }

  async clear(): Promise<ModelGatewayCredentialStatus> {
    await fs.rm(this.filePath, { force: true })
    this.value = null
    return this.status()
  }

  private get filePath(): string {
    return path.join(this.userDataDir, 'model-gateway-api-key.json')
  }

  private canEncrypt(): boolean {
    if (!this.safeStorage.isEncryptionAvailable()) return false
    try {
      return this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text'
    } catch {
      return false
    }
  }

  private storageKind(): ModelGatewayCredentialStatus['storage'] {
    return this.canEncrypt() ? 'encrypted' : 'unavailable'
  }

  private async readFile(): Promise<string | null> {
    let raw: string
    try {
      raw = await fs.readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      return null
    }
    try {
      const document = JSON.parse(raw) as StoredDocument
      if (document.version !== 1 || document.kind !== 'safe-storage') return null
      if (!this.canEncrypt()) return null
      const value = this.safeStorage.decryptString(Buffer.from(document.value, 'base64'))
      return modelGatewayCredentialKind(value) === 'legacy-literal' ? value : null
    } catch {
      return null
    }
  }

  private async writeFile(document: StoredDocument): Promise<void> {
    await fs.mkdir(this.userDataDir, { recursive: true })
    const temp = tempNameFor(this.filePath)
    try {
      await fs.writeFile(temp, JSON.stringify(document), { encoding: 'utf8', mode: 0o600 })
      await renameAtomic(temp, this.filePath)
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {})
      throw error
    }
  }
}

export const MODEL_GATEWAY_SECRET_SENTINEL = MODEL_GATEWAY_SECRET_REF
