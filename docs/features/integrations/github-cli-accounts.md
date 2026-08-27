# GitHub CLI account selector

The GitHub CLI account panel is host-owned and uses the installed `gh` executable as the
credential boundary. It discovers every host and account reported by `gh auth status --json hosts`,
marks the active account, and reads non-secret identity metadata through `gh api`. Tokens are never
returned to the renderer, written to application settings, or copied into logs, exports, project
files, or captures.

## Account operations

The account list exposes the host, login, authentication state, token-source label, OAuth scopes,
organizations, and writable owners when the CLI can provide them. Empty metadata is displayed as
unavailable or not reported, never as an invented empty capability. Selecting **Use this account**
calls `gh auth switch` and refreshes the list. Existing GitHub callers continue to resolve through
the active CLI account, so single-account integrations keep working without a second credential
store. Sign-out calls `gh auth logout` for only the selected host and login.

## Guided login and re-authorization

**Add account** starts `gh auth login --hostname github.com --git-protocol https --web` in a bounded,
hidden child process. The panel shows the one-time code and the official device URL when the CLI
provides them, opens that URL in the default browser, and lets the user cancel or wait for the
process to finish. **Refresh authorization** uses the same bounded route with `gh auth refresh` and
an optional, validated scope list. Session identifiers are random, expire after fifteen minutes,
and contain no credential material. Error text is bounded and removes token-shaped values.

When a GitHub operation reports a missing scope, the caller should open this panel and start
**Refresh authorization** for the selected account. The refresh route is intentionally beside the
account controls rather than a detached terminal instruction.

## Search and accessibility

The account collection has an isolated plain-text-first search field and an adjacent anchored full
regex builder. Each row is a semantic list item with explicit action buttons, status text, and
host/login identity. Account operations are bounded and cancellable where a child process is
running. The browser edition uses the same host-owned API and reports unsupported CLI access
honestly when `gh` is unavailable.

## Security boundaries

The service never invokes `gh auth token`, never accepts a token from the renderer, and never sends
credentials as an argument. Account metadata is collected by `gh auth status` and `gh api` only. A
temporary account switch used to inspect an inactive account is restored in a `finally` block. The
relay bridge keeps this namespace local to the viewing desktop, and the `githubCliAccounts:` host
prefix refuses peer requests before dispatch.

## Verification boundary

Issue #102 defines this source lane as implementation-only. Tests, lint, type checks, builds,
packaging, runtime interaction, reviews, audits, and UI captures are intentionally left to the
owning integration task. The branch remains available for that follow-up verification.

## Suggested articles

- [GitHub Issues](../source-control/source-control-and-worktrees.md)
- [Provider services](provider-services.md)
- [Source control and worktrees](../source-control/source-control-and-worktrees.md)
