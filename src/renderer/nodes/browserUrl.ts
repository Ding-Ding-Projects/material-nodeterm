// Moved to `@shared/browserUrl` (2026-08-26, browser-driving port): main's CDP allowlist needs the
// SAME scheme check for its Page.navigate validator, and `src/main` cannot import from
// `src/renderer`. Re-exported here so this file's existing import path (`./browserUrl`,
// `../nodes/browserUrl`) never changes for the renderer's own callers.
export { normalizeAddress } from '@shared/browserUrl'

function googleSearch(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}

/**
 * Turn an address-bar / start-page entry into a navigable http(s) URL, or a Google search for
 * free text. Returns null only for empty input. localhost/127.0.0.1 default to http (dev servers);
 * other bare hosts to https. Non-http schemes (file:/javascript:/…) are searched, never navigated.
 */
export function searchOrUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  // Explicit scheme. The negative lookahead keeps `host:port` (e.g. `localhost:3000`) out of the
  // scheme branch — a real URI scheme's colon is never immediately followed by a port digit.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw)) {
    if (/^https?:\/\//i.test(raw)) {
      try {
        return new URL(raw).toString()
      } catch {
        return googleSearch(raw)
      }
    }
    return googleSearch(raw)
  }
  // No scheme: is it a host?
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(raw)
  const looksHost = !/\s/.test(raw) && (isLocal || /^[^\s/]+\.[^\s/]+/.test(raw))
  if (looksHost) {
    try {
      return new URL(`${isLocal ? 'http' : 'https'}://${raw}`).toString()
    } catch {
      return googleSearch(raw)
    }
  }
  return googleSearch(raw)
}
