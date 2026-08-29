// Best-effort free-disk-space probe shared by the converter's destination preflight and the
// Ollama manager's per-variant hardware fit. `fs.statfsSync` is not guaranteed on every platform
// or Node build; a failure here degrades to `null` ("unknown"), never to zero — the house rule
// that missing metadata must never be treated as zero applies to disk space as much as anything.

import { statfsSync } from 'node:fs'

export function freeDiskBytes(path: string): number | null {
  try {
    const s = statfsSync(path)
    return s.bavail * s.bsize
  } catch {
    return null
  }
}
