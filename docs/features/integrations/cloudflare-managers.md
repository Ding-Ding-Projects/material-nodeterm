# Cloudflare managers

Cloudflare managers provide one guided, typed surface for Cloudflare Access, Zero Trust, Workers,
Pages, R2, D1, and Queues. The implementation is shared by the desktop shell and Server Edition:
`src/core/cloudflare/client.ts` owns the HTTPS API boundary, `src/core/cloudflare/service.ts` owns
validation, permissions, pagination, partial states, mutation previews, and the seven named manager
views, and `src/shared/cloudflare.ts` is the only shape allowed across the renderer bridge.

This lane is intentionally an account manager, not a general request console. There is no arbitrary
URL field, shell command, SQL editor, raw GraphQL document, or free-form mutation payload.

## Behaviour

The catalog contains exactly these manager destinations:

| Manager | Read surface | Typed writes | Destructive action |
| --- | --- | --- | --- |
| Access | Applications | Create application | Delete application |
| Zero Trust | Device policies | Create Gateway rule | Delete Gateway rule |
| Workers | Scripts | Deploy script | Delete script |
| Pages | Projects | Create project | Delete project |
| R2 | Buckets | Create bucket | Delete bucket |
| D1 | Databases | Create database | Delete database |
| Queues | Queues | Create queue | Delete queue |

Every list is paged with a maximum of 100 records per request. `listAll` follows the provider's
`result_info` cursor through at most 100 pages and returns a `ready`, `partial`, or `error` state.
A failed later page never becomes an empty successful list: records already read remain visible,
the failed page and retryability are reported, and the user can retry that operation.

The list records are deliberately small, stable summaries. They include provider ids, names,
status facts, timestamps, and counts where Cloudflare reports them. The wire payload, request
headers, arbitrary response fields, and credential material never reach the renderer.

### Account and credential state

The credential store implements `CloudflareTokenProvider`. Its `read()` method is used only inside
the core request boundary. The public API exposes `secretPresence()` as `present`, `absent`, or
`unknown`, never a value, length, prefix, digest, or display name. A missing credential is a real
state and does not look like an empty account.

Permission data is supplied through `CloudflarePermissionProvider` and contains permission names
only. Writes are refused when permission state is unknown, and refused with a concrete missing
permission when the required permission is absent. This keeps a stale or incomplete permission
probe from turning into an optimistic write.

### GraphQL cost

Only two named GraphQL operations are registered: `account-summary` and `workers-analytics`.
Callers select an operation id, never a document. The client sends the fixed document associated
with that id and records requested cost, actual cost, available budget, remaining budget, and reset
metadata. A requested cost above the 1,000 point ceiling is rejected before a result is returned.
GraphQL data plus an error is `partial`; errors without data are `error`.

### Typed mutations

Mutation inputs are discriminated by manager and action. Names, account ids, hostnames, expressions,
branch names, and script source are bounded and reject control characters. Access applications take
a hostname, not a URL. Workers source is bounded to 4 MiB. D1 exposes database lifecycle only; it
does not expose arbitrary SQL or a write query box. Pages deployment selection uses a project and a
branch, not a caller supplied endpoint. R2 and Queues expose bucket and queue lifecycle, not an
unscoped object or message endpoint.

Delete operations require a fresh preview id. The preview states the exact target, manager, action,
impact, ten minute expiry, and that the application's super-confirmation surface is required.
The id is consumed before execution and must match the complete typed mutation. Expired, replayed,
or mismatched previews fail without contacting Cloudflare.

## Persistence and portability

An account id or manager selection may be stored as a safe project intent when the project schema
allows it. Credentials, token state, provider sessions, host paths, caches, response bodies, and
runtime process state are machine-local and never enter a portable project file. Import is passive:
it performs no network request, deployment, account mutation, process launch, or download. Opening
the imported project presents an explicit Configure or Leave Unbound path when the local account is
not bound.

## Failure modes and recovery

| Situation | State and recovery |
| --- | --- |
| No credential | `secret: absent`; configure the local credential store. No account request is attempted. |
| Credential presence cannot be checked | `secret: unknown`; the UI names the unavailable store rather than saying no credential exists. |
| Account id or input is malformed | `invalid-request`; correct the named field. Cloudflare is not contacted. |
| Permission probe unavailable | `permissions.state: unknown`; refresh permission metadata before writing. |
| Later page fails | `partial`, with prior records and the failed page retained for retry. |
| Provider rate limit | `retryable: true`, with the bounded request error and retry action. |
| Response is too large or malformed | fail closed, preserve the previous snapshot, and show the bounded reason. |
| GraphQL cost is over the ceiling | reject the registered operation and keep the previous state. |
| Destructive preview expires or is replayed | refuse the mutation and require a new preview. |
| Cloudflare rejects a mutation | return `ok: false` with redacted, bounded error text and retryability. |

Informational and progress states are non-blocking notifications. Only the destructive decision is
blocking, and it uses the existing two-key confirmation flow. A mutation cannot be retried by a
second key event while the first call is in flight.

## Security considerations

- Requests go only to `https://api.cloudflare.com`; account and resource identifiers are encoded
  path segments and validated before URL construction.
- The authorization bearer exists only in the core's in-memory request and is never returned,
  logged, exported, placed in a project file, or included in an error.
- Response bodies are bounded at 8 MiB. Error metadata is bounded at 4 KiB and redacted for bearer,
  token, secret, password, API key, and authorization patterns.
- Lists are bounded to 100 records per response and 100 pages per full refresh. Unknown totals stay
  `null`, never zero by guess.
- GraphQL documents are fixed registry entries. There is no arbitrary query or variable document
  route.
- D1 has no SQL editor or arbitrary SQL write path. No manager accepts a shell command or a caller
  supplied request URL.
- Delete previews are one-shot, target-bound, expiry-bound, and still require the app's native
  super-confirmation. A provider permission does not replace the local confirmation.
- Imported project data is treated as hostile input and cannot trigger network activity or account
  mutation.

## Material and interaction contract

The manager destination uses the project's Material Design 3 controls, light and dark themes,
visible focus, keyboard navigation, reduced motion, and screen-reader names and states. Its account,
manager, resource, and permission lists have local plain-text search with an anchored full regex
builder. Dropdowns and context menus use the same search contract. Empty, loading, partial, stale,
and error states are distinct. Disabled actions state the missing account, permission, credential,
or preview condition beside the control.

Long refreshes report the current page, bounded progress, cancellation, partial results, and retry
action at the manager surface that started the refresh. The notification centre keeps dismissed
states reviewable. Resource rows support bulk selection and export of redacted summaries. Exports
state that credentials, response bodies, and machine-local provider data were omitted.

## Verification boundary

This implementation lane intentionally did not run tests, type checks, lint, security checks,
accessibility checks, builds, packaging, installer execution, runtime interaction checks, or UI
captures. The source and documentation describe the shipped boundary, but artifact and runtime
verification remain the explicit next Chut for the parent release lane.

## Suggested articles

- [Service nodes](service-nodes.md) for the canvas node and machine-local connection split.
- [Personal vocabulary](../../personal-vocabulary.md) for local-only wording customization.
- [Destructive confirmation](../../destructive-confirmation.md) for the two-key confirmation flow.
- [Local history](../../local-history.md) for redacted mutation history.
- [Command palette](../../command-palette.md) for destination and setting discovery.

