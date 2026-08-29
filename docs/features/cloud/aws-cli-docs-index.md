# AWS CLI model and documentation index

## Behaviour

The AWS CLI documentation index reads the installed AWS CLI v2 and botocore JSON model files from
known installation roots. It indexes every service model that can be read, every modeled operation,
its input and output shape names, nested shape members, required fields, enumerated values and
constraints, CLI options, paginator configuration, waiter acceptors, and the four AWS CLI skeleton
modes: `input`, `output`, `yaml-input`, and `yaml-output`.

Each service and operation links directly to the corresponding official AWS CLI reference page. A
local help fallback is represented as an argument vector such as `aws s3api list-buckets help`, not
as an editable shell string. This lane does not execute an AWS operation. Later operation lanes may
consume the typed model while retaining their own preview, confirmation and credential boundaries.

The renderer panel is searchable by plain text by default. Its adjacent regex builder enables an
explicit regular-expression search over service names, operations, options, waiter names and shape
metadata. Selecting a service and operation reveals model facts, input and output shapes, options,
paginators, waiters, skeleton support, and the official documentation links.

## Configuration

The loader accepts `AWS_CLI_DATA_DIR` when the AWS CLI model tree lives outside the platform's
standard installation roots. The cache location is supplied by the app's local data directory, or
can be overridden by a trusted caller for a disposable profile. An offline caller sets the loader's
`offline` option, which prevents model discovery and returns the last valid cache when one exists.
No setting contains an AWS profile, credential, access key, session token, or credential-process
command.

## Source and completeness

The parser accepts `service-2.json`, `paginators-1.json`, `waiters-2.json`, and `cli.json`. The
source is bounded before parsing: files, services, operations, shapes, members, enum values, strings,
recursion depth, and documentation text each have explicit limits in
`src/shared/aws-cli.ts`. A malformed or over-sized file is skipped and counted as a partial index;
it is never silently treated as an empty service.

The snapshot reports separate counts for model file kinds, services, operations, options, paginators,
and waiters. `complete` means all discovered model files parsed within the declared limits. `partial`
means some files were rejected or the file ceiling was reached. `unknown` means no readable service
model was available. These states are user-visible and are not inferred from the number of rows.

## Revision and cache

The core loader derives an exact SHA-256 revision from every accepted model file's kind, resolved path,
and UTF-8 bytes. A timestamp or installation folder name is not a revision. The snapshot records the
revision, observation time and file count, plus the installed root used for discovery.

The cache is stored in the app's local data directory at `aws/aws-cli-index.json`. It contains model
metadata only, never credentials, profiles, session data, command output or request payloads. Cache
states are `missing`, `loaded`, `written`, `invalid`, and `unreadable`. Invalid or unreadable bytes
are not overwritten by a refresh. When the installed source is unavailable, the last valid cache is
shown as `stale`; with offline mode enabled, it is shown as the last cached snapshot and clearly
marked offline. No cache is reported as missing, not as an empty AWS catalog.

## Installation roots and offline use

Discovery checks `AWS_CLI_DATA_DIR` first, then platform installation roots. It does not invoke
`aws`, inspect credential files, read profiles, or call an external documentation website. The
official links are deterministic HTTPS references, and the app can open them only when the user
chooses that action. The local model and cached metadata remain usable with the network unplugged.

If no model is available, the panel says what is missing and offers the local help fallback route.
It does not offer a blank operation textbox, guess an operation, or present a disabled control without
the reason and the next recovery action.

## Security considerations

- Model files are treated as untrusted JSON and parsed with bounds.
- Credentials, profiles, role sessions, SSO caches, credential-process commands and request values
  are outside this index and never enter the cache or renderer payload.
- Help is an allowlisted argv vector with validated service and operation names. It cannot carry a
  shell operator, path, URL, environment assignment or arbitrary operation payload.
- Official links are documentation only. Opening one does not claim that the local AWS CLI is
  installed, configured, authenticated or able to reach AWS.

## Verification

The implementation surface is `src/shared/aws-cli.ts` and
`src/core/aws-cli/model-loader.ts`. The renderer surface is
`src/renderer/components/aws/AwsCliDocsIndexPanel.tsx`, styled by the AWS index rules in
`src/renderer/styles.css`. The model parser and loader are designed for focused tests covering
valid service, paginator, waiter and CLI models, bounds, malformed JSON, revision changes, cache
states, offline fallback and safe help vectors. The renderer's search field uses the shared anchored
regex builder. This lane intentionally records no build, test, capture or external operation result.

## Suggested articles

- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [Regex builder](../../regex-builder.md)
- [File converter](../../file-converter.md)
- [Ollama manager](../../ollama-manager.md)
