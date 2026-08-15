// Durable, crash-recoverable persistence for the converter queue. One snapshot file
// (`converter/queue.json`) under the shell's userData dir, written ATOMICALLY (temp file + rename,
// via AtomicJsonArrayStore) so a crash mid-write can never leave a half-written, unparseable
// record — the previous good snapshot is always what's on disk until the new one is fully flushed.
// A corrupt file found on load is set aside as `queue.json.corrupt-<ts>` and the queue starts
// empty rather than crashing the app on boot.

import { join } from 'node:path'
import type { ConvertQueueItem } from '../../shared/converter'
import { AtomicJsonArrayStore } from '../atomic-json-store'

export class ConverterStore {
  private readonly inner: AtomicJsonArrayStore<ConvertQueueItem>

  constructor(userDataDir: string) {
    this.inner = new AtomicJsonArrayStore(join(userDataDir, 'converter', 'queue.json'))
  }

  load(): Promise<ConvertQueueItem[]> {
    return this.inner.load()
  }

  /** Persist the full snapshot. Calls are serialized by the underlying store (never two concurrent
   *  writers to the same file), so a burst of rapid item updates can't interleave two writes. */
  save(items: ConvertQueueItem[]): Promise<void> {
    return this.inner.save(items)
  }
}
