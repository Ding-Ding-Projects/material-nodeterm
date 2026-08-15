import { describe, it, expect } from 'vitest'
import { normalize } from 'path'
import { resolveMediaPath, mediaUrlFor } from './media-protocol'

// resolveMediaPath() runs every decoded pathname through node's platform `normalize()` before
// comparing it against the allowlist — on win32 that turns `/a/b` into `\a\b`. The real
// allowlist (allowMediaPath in media-protocol.ts) normalizes on the way in too, so the two
// sides agree in production; here the fixtures build `allow` by hand, so they have to apply
// the same normalization or a Windows run compares `\a\b` against a Set holding `/a/b` and
// every "allowed" case fails as if it were rejected. POSIX is unaffected: normalize() is a
// no-op on these forward-slash-only fixtures there.
const n = (p: string): string => normalize(p)

describe('resolveMediaPath (path jail)', () => {
  const allow = new Set([n('/projects/app/clip.mp4'), n('/projects/app/out.html')])

  it('returns the absolute path for an allowed file', () => {
    const url = mediaUrlFor('/projects/app/clip.mp4')
    expect(resolveMediaPath(new URL(url).pathname, allow)).toBe(n('/projects/app/clip.mp4'))
  })

  it('rejects a path not on the allowlist', () => {
    const url = mediaUrlFor('/etc/passwd')
    expect(resolveMediaPath(new URL(url).pathname, allow)).toBeNull()
  })

  it('rejects traversal that escapes an allowed file', () => {
    expect(resolveMediaPath('/projects/app/../../etc/passwd', allow)).toBeNull()
  })

  it('round-trips paths with spaces/unicode via mediaUrlFor', () => {
    const allow2 = new Set([n('/a b/çlip.mp4')])
    const url = mediaUrlFor('/a b/çlip.mp4')
    expect(resolveMediaPath(new URL(url).pathname, allow2)).toBe(n('/a b/çlip.mp4'))
  })

  it('round-trips a path containing ? through mediaUrlFor', () => {
    const original = '/projects/app/q?x&y#z.mp4'
    const allow3 = new Set([n(original)])
    const url = mediaUrlFor(original)
    expect(resolveMediaPath(new URL(url).pathname, allow3)).toBe(n(original))
  })
})
