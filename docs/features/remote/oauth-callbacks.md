# OAuth callbacks from remote sessions

## Behaviour

When a CLI running in an SSH project prints an OAuth authorize URL whose `redirect_uri` is an
explicit localhost callback, the desktop recognises the URL from terminal output, extracts only
the validated callback port, and creates a temporary SSH local forward to the remote host's
loopback. The authorization URL opens in the local browser, while the CLI continues to receive its
callback on the host where it is running.

The forward is limited to one port per SSH project and expires after ten minutes. Disconnecting
the project cancels it while the ControlMaster is still alive. A failed forward is reported as an
unavailable callback path and never falls back to an arbitrary host or port.

The Server Edition cannot create an SSH local forward from a browser. Its terminal detector arms a
host-local, single-use callback completer instead. After the browser redirects, the user pastes the
complete callback URL into the non-blocking notice. The server fetches it locally only when its
host, port, and path exactly match the values observed in the authorize URL.

## Configuration

There is no credential or project-file setting. The detector reads terminal output in memory. The
desktop forward uses the connected SSH project's existing ControlMaster. The Server Edition stores
only one short-lived arm per authenticated browser connection in memory.

## Failure modes and recovery

- Output without an explicit HTTP localhost redirect is ignored.
- HTTPS redirects, credentials embedded in URLs, malformed URLs, invalid ports, and paths outside
  the bounded callback grammar are rejected.
- A callback with a different host, port, path, fragment, or expired arm is refused. Start the CLI
  sign-in flow again.
- A callback listener that is unreachable or returns a status outside the successful 2xx range is
  reported as incomplete. Redirects are not followed. The one-shot arm is already consumed, so
  retry the sign-in flow.

## Security and portability

Terminal output is untrusted input. No arbitrary forward target, user-selected host, shell command,
credential, authorization code, callback body, or provider session enters project data. The SSH
destination is fixed to the connected project's remote loopback and the Server Edition fetch is
fixed to a previously observed loopback port and path. Server callback arms are scoped to the
authenticated browser connection, consumed before the request, bounded by a timeout, and never
written to disk or returned in logs.

## Verification boundary

This ultra-speed implementation lane did not run tests, type checks, lint, reviews, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
Those checks remain required before a release claims runtime verification.

## Suggested articles

- [SSH projects](./ssh-projects.md)
- [Server Edition](./server-edition.md)
- [Shared provider services](../integrations/provider-services.md)
- [Portable project binding wizard](../projects/portable-bindings.md)
