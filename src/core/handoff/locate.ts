// Per-agent transcript file locators. Each resolves an on-disk transcript path from the
// sessionId captured via hooks. Filesystem + home-dir access only — lives in core so both
// the handoff feature (src/main) and context-link (src/core) can use it.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveTranscriptPath } from '../transcript-reader'
import { codexHome } from '../usage/codex-usage'

// claude: ~/.claude/projects/<proj>/<sessionId>.jsonl — already implemented (searches all
// project dirs for the exact <sessionId>.jsonl). `accountId` scopes to a managed account's
// transcript root (default `~/.claude`).
export function locateClaude(sessionId: string, accountId?: string): Promise<string | undefined> {
  return resolveTranscriptPath(sessionId, accountId)
}

// codex: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sessionId>.jsonl — walk the tree and
// match a .jsonl filename containing the sessionId. Managed accounts are Claude-only, so the
// codex/gemini locators ignore accountId (present only to satisfy the shared Locator type).
const MAX_INDEX_FILES = 10_000
const MAX_INDEX_DIRECTORIES = 2_048
const INDEX_TTL_MS = 30_000

async function buildCodexIndex(home: string): Promise<Map<string, string>> {
  const root = path.join(home, 'sessions')
  const stack = [root]
  const index = new Map<string, string>()
  let visited = 0
  let directories = 0
  while (stack.length) {
    if (++directories > MAX_INDEX_DIRECTORIES) break
    const dir = stack.pop() as string
    let handle: fs.Dir
    try {
      handle = await fs.promises.opendir(dir)
    } catch {
      continue
    }
    try {
      for await (const e of handle) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (stack.length + directories < MAX_INDEX_DIRECTORIES) stack.push(p)
          continue
        }
        else if (e.isFile() && e.name.endsWith('.jsonl') && ++visited <= MAX_INDEX_FILES) {
          index.set(p, p)
        }
        if (visited >= MAX_INDEX_FILES) break
      }
    } finally {
      await handle.close().catch(() => {})
    }
  }
  return index
}

const codexIndexes = new Map<string, { refreshedAt: number; values: Map<string, string> }>()
const codexIndexInFlight = new Map<string, Promise<Map<string, string>>>()
const codexInFlight = new Map<string, Promise<string | undefined>>()
async function codexIndexFor(home: string): Promise<Map<string, string>> {
  const cached = codexIndexes.get(home)
  if (cached && Date.now() - cached.refreshedAt <= INDEX_TTL_MS) return cached.values
  const active = codexIndexInFlight.get(home)
  if (active) return active
  const pending = buildCodexIndex(home).then((values) => {
    codexIndexes.set(home, { refreshedAt: Date.now(), values })
    return values
  }).finally(() => codexIndexInFlight.delete(home))
  codexIndexInFlight.set(home, pending)
  return pending
}
export function locateCodex(sessionId: string, home = codexHome()): Promise<string | undefined> {
  const key = `${home}\u0000${sessionId}`
  const pending = codexInFlight.get(key)
  if (pending) return pending
  const result = (async () => {
    const values = await codexIndexFor(home)
    for (const filePath of values.values()) {
      if (path.basename(filePath).includes(sessionId)) return filePath
    }
    return undefined
  })().finally(() => codexInFlight.delete(key))
  codexInFlight.set(key, result)
  return result
}

// gemini: ~/.gemini/tmp/<proj>/chats/session-*.jsonl — find the file whose first-line
// header sessionId equals the requested sessionId.
async function buildGeminiIndex(): Promise<Map<string, string>> {
  const tmp = path.join(os.homedir(), '.gemini', 'tmp')
  const index = new Map<string, string>()
  const projects: string[] = []
  let rootHandle: fs.Dir
  try {
    rootHandle = await fs.promises.opendir(tmp)
  } catch {
    return index
  }
  try {
    for await (const entry of rootHandle) {
      if (entry.isDirectory()) projects.push(entry.name)
      if (projects.length >= MAX_INDEX_DIRECTORIES) break
    }
  } finally {
    await rootHandle.close().catch(() => {})
  }
  let visited = 0
  for (const proj of projects) {
    let chatHandle: fs.Dir
    try {
      chatHandle = await fs.promises.opendir(path.join(tmp, proj, 'chats'))
    } catch {
      continue
    }
    try {
      for await (const entry of chatHandle) {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
        if (++visited > MAX_INDEX_FILES) break
        const p = path.join(tmp, proj, 'chats', entry.name)
        try {
          const fd = await fs.promises.open(p, 'r')
          let head: string
          try {
            const buf = Buffer.alloc(8192)
            const { bytesRead } = await fd.read(buf, 0, buf.length, 0)
            head = buf.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0]
          } finally {
            await fd.close()
          }
          const o = JSON.parse(head) as { sessionId?: string }
          if (typeof o.sessionId === 'string' && o.sessionId) index.set(o.sessionId, p)
        } catch {
          /* keep looking */
        }
      }
    } finally {
      await chatHandle.close().catch(() => {})
    }
    if (visited >= MAX_INDEX_FILES) break
  }
  return index
}

let geminiIndex: { refreshedAt: number; values: Map<string, string> } | undefined
let geminiIndexInFlight: Promise<Map<string, string>> | undefined
const geminiInFlight = new Map<string, Promise<string | undefined>>()
export function locateGemini(sessionId: string): Promise<string | undefined> {
  const pending = geminiInFlight.get(sessionId)
  if (pending) return pending
  const result = (async () => {
    if (!geminiIndex || Date.now() - geminiIndex.refreshedAt > INDEX_TTL_MS) {
      geminiIndexInFlight ??= buildGeminiIndex().finally(() => { geminiIndexInFlight = undefined })
      geminiIndex = { refreshedAt: Date.now(), values: await geminiIndexInFlight }
    }
    return geminiIndex.values.get(sessionId)
  })().finally(() => geminiInFlight.delete(sessionId))
  geminiInFlight.set(sessionId, result)
  return result
}
