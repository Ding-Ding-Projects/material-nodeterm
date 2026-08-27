# AWS CLI model documentation index

The AWS CLI model documentation index is the platform-free source for guided AWS service,
command, option, paginator, waiter, input, output, and input-skeleton browsing. It consumes decoded
official model documents from the bundled AWS CLI inventory and produces deterministic picker rows
for the renderer and the later typed-form generator. It does not execute AWS commands or contact a
provider.

## Behaviour

`src/core/aws-model-documentation.ts` accepts one `AwsOfficialModelSource` per installed AWS CLI
service. Each source carries a stable service id, the CLI service token, the model version, the
official service model, and optional paginator and waiter models. The index:

- lists every bounded service and operation from the supplied model inventory;
- converts operation and member names into their AWS CLI command and option spellings;
- links service and command rows to the official AWS CLI reference on `docs.aws.amazon.com`;
- records input and output shape documentation, required members, enumerations, and numeric bounds;
- records paginator input tokens, output tokens, result keys, limits, and continuation indicators;
- records waiter delay, attempt count, acceptors, matcher state, and owning operation;
- creates a deterministic JSON-compatible input skeleton from the official input shape;
- exposes one flat search index for services, commands, options, paginators, waiters, input,
  output, and skeleton rows; and
- exposes guided service, command, and section picker models with explicit disabled-state reasons.

Plain text is the default search mode. Callers can deliberately enable regular-expression search
with the supported `i`, `m`, `s`, and `u` flags. Queries and flags are bounded. An invalid pattern
returns the unfiltered scoped rows plus the exact parser message, so a malformed expression cannot
make the installed service inventory look empty.

## Configuration and data sources

The index does not locate or download the AWS CLI itself. The bundled AWS CLI lane owns executable
resolution, verified fallback installation, version reporting, and discovery of the official model
documents. This lane accepts those decoded documents through `AwsOfficialModelSource` and validates
them again at the indexing boundary.

Optional API reference roots are accepted only when they are anonymous absolute HTTPS URLs on
`docs.aws.amazon.com`. CLI service and command reference links are generated from bounded service
and operation identifiers. No arbitrary documentation host, file path, command string, or provider
endpoint is accepted.

## Guided controls

`createAwsDocumentationPickerModel` returns real option inventories for three ordered choices:

1. Choose an installed service.
2. Choose a command from that service's official model.
3. Choose Overview, Options, Paginator, Waiters, Input, Output, or Input skeleton.

A command picker remains disabled until a service is selected. Command-specific sections remain
disabled until a command is selected. If the official model does not define a paginator, waiter,
input, or output shape, that section stays visible and names the missing model capability. An empty
installed inventory reports that the bundled AWS CLI must be repaired rather than offering a blank
textbox or an arbitrary shell fallback.

The later interactive wizard lane consumes this picker and shape data to render typed controls. It
must not replace the picker with raw command entry, a shell field, or an unvalidated request editor.

## Portability and local state

Only safe browsing intent is portable. `projectAwsDocumentationSelection` accepts exactly:

- `serviceId`;
- `commandName`; and
- the selected documentation `section`.

The projection rejects unknown fields and refuses a command without a service. It performs no
network request, process launch, provider mutation, download, or deployment. Importing the
selection only restores which documentation should be shown.

The omission report states that installed executable paths, decoded model caches, generated runtime
indexes, credentials, profiles, provider sessions, account and role identity, endpoints, paginator
cursors, waiter progress, command results, and process state remain machine-local. The report is
generic and never includes an actual credential, private path, machine identity, or provider value.

## Bounds and failure modes

- A non-object model, inherited prototype, malformed identifier, duplicate service or command,
  unknown selection field, or non-finite numeric constraint is refused.
- Service, operation, shape, member, waiter, text, identifier, query, and skeleton depth counts are
  bounded before expansion.
- Recursive model shapes stop at a fixed depth and emit a visible shape reference instead of
  recursing without limit.
- Unsupported or unsafe documentation URLs are refused rather than opened.
- Missing referenced shapes remain visible as named references. The index never invents a type or
  silently drops the option.
- An unavailable model inventory returns a guided disabled state with a repair action.

## Security and privacy

The module is deterministic and platform-free. It imports no desktop runtime, opens no file,
spawns no process, contacts no network service, reads no environment variable, and accepts no
credential or arbitrary command. Generated documentation text is flattened to plain text before it
reaches picker summaries. Source documents and generated indexes are runtime data and are not
stored in the shared project file.

## Surface decisions

- **Desktop:** the installed AWS CLI inventory and later AWS nodes use this index for guided local
  documentation browsing.
- **Server Edition:** the same pure index can operate when the server installation supplies the
  bundled model inventory. If that inventory is absent, the exact repair state is shown.
- **Mobile companion:** not implemented in this repository. A future protocol would need a bounded,
  read-only documentation projection and must not transfer credentials, local paths, or model
  caches.

## Verification status

This implementation lane intentionally did not run tests, type checks, lint, reviews, security
checks, accessibility checks, builds, packaging, installer execution, runtime interaction, or UI
captures. The source and documentation records are present, but those unrun checks provide no
runtime or packaged-artifact verdict.

## Suggested articles

- [Special-universe Shop nodes](./aws-universe-shop.md)
- [Unified Node Catalog](../canvas/node-catalog.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [Portable Node Universes and Hosting Program](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
