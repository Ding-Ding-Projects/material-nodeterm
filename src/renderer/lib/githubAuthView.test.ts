import { describe, it, expect } from 'vitest'
import { describeGitHubAuth, tokenFieldIsPrimary, type GitHubAuthInput } from './githubAuthView'

const base: GitHubAuthInput = {
  approved: true,
  provider: 'auto',
  activeProvider: null,
  tokenPresent: false
}

describe('describeGitHubAuth', () => {
  it('is neutral (unapproved) before approval, never "signed out" — even if the flag says so', () => {
    // The host masks the auth block to ghAuthenticated:false/activeProvider:null pre-approval; the
    // row must not read that as "not signed in" and tell the user to run gh auth login.
    expect(describeGitHubAuth({ ...base, approved: false, activeProvider: 'gh' })).toEqual({ kind: 'unapproved' })
    expect(describeGitHubAuth({ ...base, approved: false })).toEqual({ kind: 'unapproved' })
  })

  it('reports the CLI happy path only when gh is the ACTIVE provider', () => {
    expect(describeGitHubAuth({ ...base, activeProvider: 'gh', login: 'enes' }))
      .toEqual({ kind: 'gh', login: 'enes', pinned: false, tokenPresent: false })
  })

  it('marks the CLI path as pinned when the user forced gh-only', () => {
    const v = describeGitHubAuth({ ...base, provider: 'gh', activeProvider: 'gh' })
    expect(v).toMatchObject({ kind: 'gh', pinned: true })
  })

  it('surfaces a saved token as a fallback fact on the CLI path', () => {
    const v = describeGitHubAuth({ ...base, activeProvider: 'gh', tokenPresent: true })
    expect(v).toMatchObject({ kind: 'gh', tokenPresent: true })
  })

  it('reports the token path when a saved token authenticates requests', () => {
    expect(describeGitHubAuth({ ...base, provider: 'token', activeProvider: 'token', tokenPresent: true }))
      .toEqual({ kind: 'token' })
  })

  it('does NOT claim CLI sign-in when gh is up but the provider is pinned to a missing token', () => {
    // The regression: ghAuthenticated could be true while activeProvider is null (token pinned, no
    // token) — a request would fail, so this must be a "need-token", not a green check.
    expect(describeGitHubAuth({ ...base, provider: 'token', activeProvider: null }))
      .toEqual({ kind: 'need-token' })
  })

  it('points at gh auth login when nothing authenticates and gh is allowed', () => {
    expect(describeGitHubAuth({ ...base, provider: 'auto', activeProvider: null }))
      .toEqual({ kind: 'need-gh', allowToken: true })
    // gh-only pinning: a pasted token would be inert, so allowToken is false.
    expect(describeGitHubAuth({ ...base, provider: 'gh', activeProvider: null }))
      .toEqual({ kind: 'need-gh', allowToken: false })
  })
})

describe('tokenFieldIsPrimary', () => {
  it('foregrounds the token field only when a token is actionable', () => {
    expect(tokenFieldIsPrimary({ kind: 'need-token' })).toBe(true)
    expect(tokenFieldIsPrimary({ kind: 'need-gh', allowToken: true })).toBe(true)
    expect(tokenFieldIsPrimary({ kind: 'need-gh', allowToken: false })).toBe(false)
    expect(tokenFieldIsPrimary({ kind: 'gh', pinned: false, tokenPresent: false })).toBe(false)
    expect(tokenFieldIsPrimary({ kind: 'token' })).toBe(false)
    expect(tokenFieldIsPrimary({ kind: 'unapproved' })).toBe(false)
  })
})
