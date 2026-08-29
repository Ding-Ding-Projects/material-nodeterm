# One-click Cloudflare Tunnel

## Behaviour

The Cloudflare Tunnel node guides a private origin through one reviewable plan. It discovers
accounts and zones from the Cloudflare API, then discovers running local Docker containers,
networks, published ports, and private HTTP origins through a fixed argument-array Docker probe.
The user chooses the account, zone, hostname, host, container, network, port, and origin from
typed controls. There is no arbitrary ingress editor, shell command, image field, or environment
editor.

Preflight runs five checks before any mutation: API permission, hostname ownership within the
selected zone, discovered origin selection, private origin egress, and the Access policy. Access
is deny-first. A tunnel is not exposed through DNS until the deny policy exists, and the user must
add any allow policy as a separate deliberate action.

Apply creates a remotely managed tunnel, writes its ingress configuration, creates the deny-first
Access application and policy, creates the proxied CNAME record, and starts the pinned
`cloudflare/cloudflared` connector with a protected token file. The token is never placed in an
argument or environment variable. The node reports each resulting identifier as status metadata,
without revealing the token.

## Configuration

The safe project intent stores only the hostname, tunnel display name, and `deny-first` policy
choice. Account and zone bindings, host and container identifiers, local ports, connector state,
and token-file paths are machine-local. Reopening the project on another computer therefore shows
an explicit configuration route instead of silently selecting a similarly named resource.

The desktop connector uses a pinned image, read-only root, dropped capabilities, no-new-privileges,
bounded memory and process limits, an explicit Docker network, and a read-only bind mount for the
token file. It does not mount the Docker socket or use host networking. The browser Server Edition
can use the Cloudflare API surface but reports that it has no local connector runtime, rather than
claiming that a browser owns a Docker daemon.

## Failure modes and recovery

Missing or invalid API credentials, an unavailable account or zone, a hostname outside the selected
zone, a stopped or disappeared origin, a public origin, an unsupported port, and a missing Docker
runtime are shown beside the affected control with a recovery action. A failed apply attempts to
remove the connector, DNS record, Access application, and tunnel resources it created. The explicit
Rollback action repeats that cleanup and clears the machine-local binding. Existing unmanaged DNS
records and Access applications are preserved.

## Security considerations

The API token is sealed in the application credential store and can be cleared from the token
control. Tunnel tokens are held only in the trusted core while the connector writes its protected
token file. The renderer receives only `configured`, identifiers, status, and human-readable
diagnostics. User input is validated before it reaches the API or Docker argument vector, and the
Docker runtime accepts only discovered container and network identifiers.

The connector token file is local application data and is not part of project files, exports,
history, logs, or status records. The selected origin must be localhost or a private network
address. The wizard never makes a public origin reachable by guessing a URL or port.

## Verification

The ultra-speed implementation lane deliberately did not run tests, type checking, lint, security
review, accessibility review, runtime interaction, installer execution, builds, packaging, or UI
captures. Those checks remain required before a release claim. The implementation records its
typed API, renderer, and Docker argument boundaries so those checks can exercise the real seam.

## Suggested articles

- [Docker host](./docker-host.md)
- [Server Edition](./server-edition.md)
- [SSH projects](./ssh-projects.md)
- [Global and project settings](../global-and-project-settings.md)

