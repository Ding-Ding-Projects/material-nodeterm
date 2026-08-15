// Small generic helper for "persist an array snapshot to one JSON file, atomically, with crash
// recovery" — shared by the converter queue and the Ollama pull queue so the same atomic-write +
// corrupt-file-quarantine discipline lives in exactly one place.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { renameAtomic } from './fs-atomic'

export class AtomicJsonArrayStore<T> {
  constructor(private readonly file: string) {}
  private writing: Promise<void> = Promise.resolve()

  async load(): Promise<T[]> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) throw new Error('not an array')
      return parsed as T[]
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      try {
        await mkdir(dirname(this.file), { recursive: true })
        await renameAtomic(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        // best-effort — start empty regardless
      }
      return []
    }
  }

  save(items: T[]): Promise<void> {
    this.writing = this.writing.then(() => this.writeNow(items))
    return this.writing
  }

  private async writeNow(items: T[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, JSON.stringify(items), 'utf8')
    await renameAtomic(tmp, this.file)
  }
}
