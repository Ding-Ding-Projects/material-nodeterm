// Codex keeps the authoritative sidebar/task title on the shared app-server's Thread object.
// The per-node identity proxy is the single place where those responses and notifications pass,
// so it records names here for both the mounted-node poll and the background mirror sweep.
const names = new Map<string, string>()

export function rememberCodexSessionName(threadId: string, name: unknown): void {
  if (!threadId) return
  if (typeof name === 'string' && name.trim()) names.set(threadId, name.trim())
  else if (name === null || name === '') names.delete(threadId)
}

export function readCodexSessionName(threadId: string): Promise<string | null> {
  return Promise.resolve(names.get(threadId) ?? null)
}

export function forgetCodexSessionNames(): void {
  names.clear()
}
