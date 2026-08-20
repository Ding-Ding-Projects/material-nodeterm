/**
 * Reading vanilla's own whitelist.json / ops.json / banned-players.json — read-only, on purpose.
 * Every managed action (add/remove/op/deop/ban/pardon/kick) goes through the running server's own
 * console via the existing `sendCommand`, which is how vanilla actually resolves a name to a
 * UUID, actually writes these files back out (with its own locking), and actually notifies a
 * connected player. Editing the JSON directly here would race a live server writing the same
 * file, and offline it cannot resolve a UUID at all — so this module only ever reads, and the
 * manager refuses those actions while nothing is running (see server-manager.ts). Malformed or
 * missing files degrade to an empty list rather than throwing: a fresh instance that has never
 * been started has none of these files yet, and that is not an error.
 */

export interface MinecraftPlayerEntry {
  name: string
  uuid: string
}

export interface MinecraftBannedPlayerEntry extends MinecraftPlayerEntry {
  reason: string | null
  expires: string | null
}

export interface MinecraftPlayerLists {
  whitelist: MinecraftPlayerEntry[]
  ops: MinecraftPlayerEntry[]
  banned: MinecraftBannedPlayerEntry[]
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

export function parsePlayerEntries(raw: unknown): MinecraftPlayerEntry[] {
  if (!Array.isArray(raw)) return []
  const out: MinecraftPlayerEntry[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const r = entry as Record<string, unknown>
    const name = asString(r.name)
    const uuid = asString(r.uuid)
    if (name && uuid) out.push({ name, uuid })
  }
  return out
}

export function parseBannedEntries(raw: unknown): MinecraftBannedPlayerEntry[] {
  if (!Array.isArray(raw)) return []
  const out: MinecraftBannedPlayerEntry[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const r = entry as Record<string, unknown>
    const name = asString(r.name)
    const uuid = asString(r.uuid)
    if (name && uuid) {
      out.push({ name, uuid, reason: asString(r.reason), expires: asString(r.expires) })
    }
  }
  return out
}
