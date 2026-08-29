// What the GitHub Issues "Authentication" row should SAY and SHOW, decided once from the resolved
// control view. Pulled out of the component so the branch logic is unit-testable — the settings UI
// only maps each kind to copy + which controls to surface.
//
// Why this exists (two bugs the naive `ghAuthenticated` flag caused):
//  1. The host masks the auth block to `{ghAuthenticated:false, activeProvider:null}` for an
//     UNAPPROVED project (it won't resolve credentials before the user consents), and approval
//     comes AFTER this row in the setup flow — so a signed-in user briefly saw "not signed in, run
//     gh auth login". `unapproved` is its own neutral state, never "signed out".
//  2. What actually authenticates a request is `activeProvider`, not `ghAuthenticated`. gh can be
//     signed in while the provider is pinned to `token` with no token saved (`activeProvider:null`)
//     — a request would fail, so we must NOT show the green "✓ signed in via CLI" there.

export type GitHubAuthProviderPref = 'auto' | 'gh' | 'token'

export interface GitHubAuthInput {
  /** The repository must be approved on this machine before the host resolves any credential. */
  approved: boolean
  /** The user's provider preference (`view.control.authProvider`). */
  provider: GitHubAuthProviderPref
  /** Which provider actually authenticates requests right now, or null if none does. */
  activeProvider: 'gh' | 'token' | null
  /** Whether a saved personal access token exists (independent of whether it's the active one). */
  tokenPresent: boolean
  /** The authenticated login, when known. */
  login?: string
}

export type GitHubAuthView =
  // Can't tell yet — approval gates credential resolution. Neutral, never "signed out".
  | { kind: 'unapproved' }
  // A request authenticates via the GitHub CLI. `pinned` = the user forced gh-only.
  | { kind: 'gh'; login?: string; pinned: boolean; tokenPresent: boolean }
  // A request authenticates via the saved personal access token.
  | { kind: 'token' }
  // Nothing authenticates and the preference allows gh → point at `gh auth login`.
  // `allowToken` (auto only) = a pasted token would also work, so surface the field.
  | { kind: 'need-gh'; allowToken: boolean }
  // Nothing authenticates and the preference is pinned to token → a token is the only way in.
  | { kind: 'need-token' }

export function describeGitHubAuth(input: GitHubAuthInput): GitHubAuthView {
  if (!input.approved) return { kind: 'unapproved' }
  if (input.activeProvider === 'gh') {
    return { kind: 'gh', login: input.login, pinned: input.provider === 'gh', tokenPresent: input.tokenPresent }
  }
  if (input.activeProvider === 'token') return { kind: 'token' }
  // Nothing authenticates. A token only helps when the preference would actually consult it.
  if (input.provider === 'token') return { kind: 'need-token' }
  return { kind: 'need-gh', allowToken: input.provider === 'auto' }
}

/** Whether the token field belongs in the FOREGROUND (it's the way in) rather than tucked into
 *  "Advanced". True only when a token is currently actionable. */
export function tokenFieldIsPrimary(view: GitHubAuthView): boolean {
  return view.kind === 'need-token' || (view.kind === 'need-gh' && view.allowToken)
}
