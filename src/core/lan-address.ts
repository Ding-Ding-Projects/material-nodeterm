/**
 * Pure helpers for "what address does another device on this network use to reach something this
 * machine is serving" — currently the Minecraft server manager's connect-address banner, but kept
 * generic and dependency-free so anything else that needs the same fact can reuse it rather than
 * re-deriving it slightly differently.
 */

/** Minimal shape of `os.networkInterfaces()` we need — kept structural so a test can fake it
 *  without touching a real network stack. Mirrors `NetInterfaceAddr` in
 *  `src/main/pairing-core.ts`, which does the same lookup for LAN pairing; this copy exists
 *  because `src/core` may not import from `src/main`. */
export interface NetInterfaceAddr {
  address: string
  family: string | number
  internal: boolean
}

/**
 * Pick a usable LAN IPv4 from `os.networkInterfaces()`, skipping internal (loopback) and
 * link-local (169.254.x.x) addresses. Returns null when none is present — never a loopback
 * address, which would be presented to the user as something another device can reach when it
 * cannot be.
 */
export function pickLanIPv4(interfaces: Record<string, NetInterfaceAddr[] | undefined>): string | null {
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue
    for (const a of addrs) {
      const isV4 = a.family === 'IPv4' || a.family === 4
      if (!isV4 || a.internal) continue
      if (a.address.startsWith('169.254.')) continue
      return a.address
    }
  }
  return null
}

/** Mojang's vanilla server default when `server-port` is absent from `server.properties` — the
 *  file this app writes is the vanilla file, and the vanilla server itself falls back to this. */
export const DEFAULT_MINECRAFT_PORT = 25565

/**
 * Parse the `server-port` key out of a raw `server.properties` file. Vanilla `.properties` files
 * are `key=value` lines with `#` comments; this reads only the one key that matters here rather
 * than a general parser, and falls back to the documented default on anything that isn't a valid
 * port number (missing key, blank value, out-of-range, non-numeric) — never a guess presented as
 * a fact.
 */
export function parseServerPort(raw: string): number {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    if (key !== 'server-port') continue
    const value = trimmed.slice(eq + 1).trim()
    const port = Number(value)
    if (Number.isInteger(port) && port > 0 && port <= 65535) return port
    break
  }
  return DEFAULT_MINECRAFT_PORT
}
