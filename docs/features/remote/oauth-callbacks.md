# Remote OAuth localhost callbacks

**Category:** [Remote & SSH](./README.md)

Remote command-line tools sometimes start an OAuth login by listening on a loopback port such as
`http://localhost:3118/callback`. When the command runs in an SSH project, the browser completing
the login is normally on a different computer. When the command runs in Server Edition, the
browser is connected to the server but still cannot make the server's loopback listener receive a
redirect.

## Behaviour

The terminal output detector looks only for an HTTPS or HTTP authorize URL containing a
`redirect_uri` whose host is `localhost`, `127.0.0.1`, or `::1`, plus a provider `state` value. It
does not treat arbitrary terminal URLs as callbacks. The detector keeps a bounded rolling output
window and arms each observed authorize URL once.

On the Desktop SSH path, the existing ControlMaster opens a temporary local forward for the exact
observed port, then opens the authorize URL in the local browser. The forward is removed when the
five-minute handoff expires, when the project disconnects, or when the handoff is cancelled. No
second SSH login is started.

On Server Edition, the browser opens the authorize URL and a guided, non-blocking panel asks the
user to paste the complete callback URL after the browser returns to localhost. The server checks
the callback locally and fetches it from the loopback listener on the session host. The panel shows
the provider, callback path, expiry countdown, retryable failure state, and cancellation action.

## Configuration and persistence

There is no setting and no project-file entry. Callback tickets, provider state, session identity,
port, and expiry are memory-only. Closing the application, disconnecting a project, or restarting
Server Edition removes pending handoffs. This keeps machine paths, authorization responses, and
provider credentials out of shared project data and local history.

## Failure modes and recovery

- A URL without a loopback `redirect_uri` or provider `state` is ignored.
- A disconnected SSH project reports that the callback handoff is unavailable and offers reconnect
  as the recovery action.
- A port-forward failure reports that the temporary tunnel could not be opened. The user can
  reconnect and restart the provider login.
- A Server Edition callback with the wrong host, port, path, or provider state is rejected without
  a network request. The user must paste the callback URL from the same sign-in flow.
- An expired, cancelled, or already-used ticket cannot be replayed. A new provider sign-in creates
  a new ticket.
- A loopback fetch that fails or returns a non-success response is reported as incomplete. The
  consumed ticket is not retried, which prevents an authorization response from being replayed.

## Security considerations

The terminal is an untrusted source. Only a bounded loopback callback can arm the feature, and the
server never accepts a user-supplied host or arbitrary port. Provider state is bound to one ticket,
session, and observed provider host. A ticket is consumed before the Server Edition fetch begins,
so concurrent requests and replays cannot trigger a second callback.

Callback URLs and authorize URLs are not logged, persisted, exported, placed in project files, or
sent to telemetry. The callback response body is discarded. Server Edition fetches use a bounded
timeout and manual redirect handling, so a callback cannot turn the completer into a general
network fetcher.

## Verification

The shared parser and registry are designed for focused local verification of valid and invalid
loopback hosts, provider-state mismatch, wrong port/path, expiry, cancellation, and replay. The
Desktop and Server Edition paths share the same renderer detector and API contract, while the
Desktop-only ControlMaster forward and Server Edition-only loopback fetch remain separate at the
host boundary.

This lane intentionally does not run tests, builds, type checks, lint, runtime interaction checks,
or screen captures. Those checks remain release work for the owning integration pass.

## Suggested articles

- [SSH projects](./ssh-projects.md) for the ControlMaster connection lifecycle.
- [Server Edition](./server-edition.md) for browser-hosted sessions and its local host boundary.
- [Agent support](../agents/README.md) for terminal agent launch and session behaviour.

