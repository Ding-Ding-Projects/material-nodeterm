# Generic all-service AWS manager

The generic AWS manager renders an interactive form directly from the installed AWS CLI service
models. It is the fallback that keeps newly installed services useful before a dedicated manager
exists. There is no command textbox, arbitrary shell input, or raw request editor.

## Behaviour

The model catalog records the CLI version, model revision, load time, and every discovered service
and operation. Each operation contributes its documented input shape, output shape, enum values,
bounded numbers, booleans, dates, timestamps, files, nested structures, repeatable lists, and maps.
The panel renders those shapes as typed controls and preserves the generated request as structured
data.

Services and operations each have an independent plain-text search with an adjacent anchored Regex
Builder. Plain text is the default. Switching to regular expressions keeps the current query and
exposes the real JavaScript regular-expression engine, flags, syntax feedback, bounded samples,
matches, capture groups, and copy action.

The input tab also exposes profile, region, endpoint, output format, retry count, pagination,
waiter, and CLI skeleton choices. Pagination and waiter identifiers remain model metadata; the host
executor uses them to drive bounded page retrieval and polling rather than inventing unsupported
CLI flags. A guided JMESPath picker is populated from output fields declared by the model.

Before execution, the risk preview shows the service, operation, profile, region, endpoint,
pagination, waiter, streaming mode, retry budget, output mode, and exact argument vector. The user
must explicitly acknowledge the preview. Destructive operations remain visibly marked and are
handed to the app's existing two-key confirmation flow by the host executor.

## Configuration and host boundary

`src/shared/aws-generic.ts` defines the model schema, invocation settings, argument-vector builder,
validation, preview data, and execution result. `buildAwsArgv` returns an array of arguments, never
a shell string. The renderer component is `src/renderer/components/aws/AwsGenericServicePanel.tsx`.
The component accepts callbacks for loading the installed model catalog, choosing a local file, and
executing an invocation. The host callback owns the AWS CLI process and credentials.

The host should pass credentials through the operating-system credential store and the AWS CLI's
normal profile mechanism. Credentials, session tokens, local paths, process identifiers, and raw
responses are not included in portable project data, logs, exports, or status records.

## Long operations and failure modes

Execution uses one `AbortController` per invocation. Cancel requests abort the active host request,
while bounded retries re-use the same typed settings and stop immediately when cancelled. Streaming
operations keep a live status line until the host returns. The result reports pages, attempts,
duration, and whether cancellation occurred. A failed catalog load is distinct from an empty
catalog, and a failed operation leaves the previous result visible until the user chooses to retry.

An unavailable file picker is disabled with its exact reason. An invalid endpoint must be HTTPS,
and unsupported control characters, invalid names, non-finite numbers, oversized values, and retry
counts outside 0 to 5 are rejected before the host callback runs.

## Security considerations

The panel never accepts arbitrary executable text or shell syntax. Service and operation identifiers
are validated, values are bounded, and argv tokens are passed to the host as data. The endpoint is
restricted to HTTPS, and custom endpoints are called out in the risk preview. Pagination, waiters,
streaming, retries, and cancellation are explicit settings rather than hidden loops.

The model index is treated as data from the installed CLI. A newly discovered service is not assumed
safe merely because its name looks familiar, so each operation carries an explicit read, write, or
destructive risk value from the host-side model policy. Destructive execution is never enabled by a
decorative checkbox.

## Verification status

This lane added the shared model contract, typed argv generation, and renderer surface. Automated
tests, type checks, builds, packaging, installer execution, runtime interaction, security review,
accessibility review, and UI captures are intentionally deferred to the orchestrating release pass.

## Suggested articles

- [Service nodes](./service-nodes.md)
- [AWS and portable project scopes](../projects/projects-and-tabs.md)
- [Command palette](../../command-palette.md)
- [Regex Builder](../../regex-builder.md)
