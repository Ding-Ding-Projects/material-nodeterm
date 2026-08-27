# Cloudflare Access, Zero Trust, Workers, Pages, R2, D1 and Queues managers

This feature adds one canvas manager node for seven related Cloudflare surfaces. It is a guided
client for the documented Cloudflare API, not a raw HTTP console and not a shell runner.

## Behaviour

The manager lists seven fixed families: Access, Zero Trust, Workers, Pages, R2, D1 and Queues.
Each family exposes typed operations such as listing resources, creating a resource, and removing a
selected resource. Workers deployment accepts a local JavaScript or module file through the native
file picker. It never accepts a URL, command string, arbitrary method, arbitrary path, or raw request
body.

The account section lists configured accounts and allows a new account label, 32-character account
identifier, and API token to be entered. The token is written only to the local protected store by
the trusted core. The renderer receives account summaries with `credentialStored: true`, never the
token itself. A node can be rebound to another configured account without changing its portable
project intent.

Every manager list, operation list, verified-resource list, and picker has its own plain-text-first
search field and adjacent anchored full regex builder. Invalid regex is visible beside its field and
does not silently hide the list. The result lists are bounded and keyboard-operable.

Write operations show a progress surface with phase and count. A destructive operation opens the
existing two-key confirmation flow and is rejected by the core unless the final preview carries an
explicit confirmation. Cancellation aborts the in-flight request. Responses are bounded, parsed as
Cloudflare's JSON envelope, and redacted before the renderer sees an output preview.

## Portability and persistence

`CloudflarePortableIntent` in `src/shared/cloudflare-zero-trust.ts` contains only the selected
manager, operation, safe field values, and optional neutral hints. Schema 3 project projection
accepts that object and rejects unknown or malformed keys. Account identifiers, credential
references, provider sessions, resource identifiers, local Worker file paths, response caches,
progress, and operation state remain in the machine-local binding file and protected account store.

Importing a project only restores the neutral selection. It does not call the network, deploy a
resource, start a process, or select a local file. On a new computer the node remains visibly
unbound until the user chooses a local account and, for a file operation, chooses a file again.
Export copy explains these omissions rather than pretending the node is ready to run everywhere.

## Security and bounded data

The core owns the HTTPS call to `https://api.cloudflare.com/client/v4`. It uses a fixed route table,
`redirect: error`, a 60-second deadline, an 8 MiB response bound, and a bounded result/resource
projection. The API token is sent only in the core's Authorization header and is not placed in a
command argument, environment variable, project file, log, history entry, export, or preview.

Field values are typed and validated before the request is built. Resource ids are selected from a
verified list where available, and every route is constructed from a manager and operation key that
the shared catalog declares. Unknown manager or operation keys are rejected. Workers bytes are read
from a user-selected local file only, with the same 8 MiB bound.

The browser and relay surfaces expose an honest unavailable or unsupported state because their
remote-routed Cloudflare manager channel is not part of this lane. They do not silently run against
the viewer's local account.

## Failure modes and recovery

- No account is configured: the operation control stays disabled and the account section names the
  exact next action, **Save account**.
- The selected account was removed or its local binding is stale: the manager asks the user to
  reconfigure or rebind; it does not guess another account.
- Cloudflare is offline, returns invalid JSON, exceeds the size bound, refuses the credential, or
  returns a non-success envelope: the error is shown in the manager and the prior intent remains.
- A request times out or is cancelled: the active request is aborted, the state is marked failed or
  cancelled, and no success is reported.
- A destructive operation is missing its explicit two-key confirmation: the core refuses it before
  contacting Cloudflare.
- A project is imported without the local account or Worker file: the node stays unbound and gives
  the user the local Configure or Locate Asset route.

## Verification boundary

This ultra-speed lane intentionally ran no tests, type checks, lint, builds, packaging, reviews,
security checks, accessibility checks, installer execution, runtime interaction, or UI captures.
The implementation is committed for the parent integration lane to verify against the exact commit.

## Suggested articles

- [Service nodes](./service-nodes.md)
- [Portable schema 3 projects](../projects/portable-schema3.md)
- [Portable bindings](../projects/portable-bindings.md)
- [Regex builder](../../regex-builder.md)
- [Destructive confirmation](../../destructive-confirmation.md)
