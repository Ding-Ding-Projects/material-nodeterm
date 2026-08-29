import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { writeFileAtomic } from '../fs-atomic'
import { UNIGETUI_DEFAULT_UNIVERSE_STATE, sanitizeUniGetUiState, type UniGetUiUniverseState } from '../../shared/unigetui'

const FILE_NAME = 'unigetui-global-universe.json'

/** Machine-local presentation state for the UniGetUI Global Universe.
 *
 * This store intentionally contains no package rows, manager executable paths, operation output,
 * tokens, credentials, or active project ids. It is safe to use from the desktop and Server
 * Edition cores, and its file lives beside other application data, never in a project folder.
 */
export class UniGetUiUniverseStore {
  private stateValue: UniGetUiUniverseState = { ...UNIGETUI_DEFAULT_UNIVERSE_STATE }
  private loaded = false
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly userDataDir: string) {}

  private get filePath(): string { return path.join(this.userDataDir, FILE_NAME) }

  async load(): Promise<UniGetUiUniverseState> {
    if (this.loaded) return { ...this.stateValue }
    this.loaded = true
    try {
      const bytes = await readFile(this.filePath, 'utf8')
      this.stateValue = sanitizeUniGetUiState(JSON.parse(bytes))
    } catch {
      this.stateValue = { ...UNIGETUI_DEFAULT_UNIVERSE_STATE }
    }
    return { ...this.stateValue }
  }

  async save(value: unknown): Promise<UniGetUiUniverseState> {
    const next = sanitizeUniGetUiState(value)
    const snapshot = { ...next, updatedAt: Date.now() }
    this.stateValue = snapshot
    this.loaded = true
    const run = this.writeChain.then(async () => {
      await mkdir(this.userDataDir, { recursive: true })
      await writeFileAtomic(this.filePath, JSON.stringify(snapshot, null, 2) + '\n', { mode: 0o600 })
    })
    // Keep the internal FIFO settled after a failed write so one transient filesystem error
    // cannot silently disable every later save. The caller still receives this write's error.
    this.writeChain = run.catch(() => {})
    await run
    return { ...snapshot }
  }
}
