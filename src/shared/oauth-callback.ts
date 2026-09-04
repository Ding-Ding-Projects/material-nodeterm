export interface ParsedOAuthAuthorizeUrl {
  authorizeUrl: string
  provider: string
  redirectPort: number
  redirectPath: string
  state: string
}

const MAX_AUTHORIZE_URL_LENGTH = 16_384
const MAX_STATE_LENGTH = 512

function loopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65_535
}

/** Find the first OAuth authorize URL whose redirect_uri is a loopback callback. */
export function parseOAuthAuthorizeUrl(text: string): ParsedOAuthAuthorizeUrl | null {
  if (!text || text.length > 64 * 1024) return null
  const candidates = text.match(/https?:\/\/[^\s'"<>]+/gi) ?? []
  for (const candidate of candidates) {
    const trimmed = candidate.replace(/[),.;]+$/, '')
    if (trimmed.length > MAX_AUTHORIZE_URL_LENGTH) continue
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    if (!url.hostname || loopbackHost(url.hostname)) continue
    const redirectRaw = url.searchParams.get('redirect_uri')
    const state = url.searchParams.get('state')
    if (!redirectRaw || !state || state.length > MAX_STATE_LENGTH) continue
    let redirect: URL
    try {
      redirect = new URL(redirectRaw)
    } catch {
      continue
    }
    if (redirect.protocol !== 'http:' || !loopbackHost(redirect.hostname)) continue
    if (!validPort(Number(redirect.port))) continue
    if (redirect.username || redirect.password || redirect.search || redirect.hash) continue
    return {
      authorizeUrl: trimmed,
      provider: url.hostname.toLowerCase(),
      redirectPort: Number(redirect.port),
      redirectPath: redirect.pathname || '/',
      state
    }
  }
  return null
}

