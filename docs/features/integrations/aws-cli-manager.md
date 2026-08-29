# AWS CLI v2 manager

The desktop and Server Edition surfaces include an AWS CLI v2 manager for Windows x64. It keeps
the CLI installation local to the current user, verifies the exact AWS-published installer bytes,
and exposes a model inventory sourced through the installed CLI's documented Amazon Bedrock API.

## Provenance and installation

The pinned release is AWS CLI v2 `2.36.31` for `win32-x64`. The official user installer is
`https://awscli.amazonaws.com/AWSCLIV2-User-2.36.31.msi?src=script-exe` and its expected SHA-256 is
`300d490cebe7d89913acc0f7ca1c585032fd2a7f698e809d7ce9905614013acd`.

The manager first checks the packaged resource path
`resources/aws/AWSCLIV2-User-2.36.31.msi`. If the packaged resource is absent or its digest does
not match, it downloads the same versioned installer from the official AWS endpoint into the
application-data cache, streams progress, hashes the complete file, and refuses to install on any
digest mismatch. The MSI is invoked unattended for the current user. No manual installation step,
PATH mutation, administrator prompt, or third-party download is used.

The executable resolver uses only the app-owned versioned cache and AWS's documented current-user
location under `%LOCALAPPDATA%\Programs\Amazon\AWSCLIV2`. PATH is intentionally not an authority,
because a packaged application can inherit a different PATH from an interactive shell. Before an
operation is offered, the manager runs the resolved executable with a bounded timeout and compares
the reported version to the pinned manifest.

## Recovery and offline behavior

Install and repair are cancellable. A cancelled download removes its partial file, and an installer
process is terminated without claiming that the CLI is ready. A failed digest, installer exit, or
post-install version check is shown as a failure with the exact recovery action, while the previous
valid executable remains in place.

When the official endpoint cannot be reached, the manager keeps the existing valid CLI usable and
reports an offline state. Model inventory data is cached in the application-data directory with a
fetch timestamp. An offline or failed refresh shows that last verified inventory as stale, rather
than replacing it with an empty or guessed list. Credentials, environment values, and process
state are not cached or returned by this surface.

## Model inventory

The Foundation models tab invokes:

```text
aws bedrock list-foundation-models --output json --no-cli-pager
```

The result is parsed defensively into model id, name, provider, input and output modalities,
streaming support, customizations, and inference types. Unparseable rows are omitted and the panel
states that the result was incomplete. The search field is plain text by default and has its own
anchored regex builder. The browser edition performs the same operation on the server host through
the shared RPC surface. A relay session keeps the operation local to its owning machine and does
not fall back to the viewing computer.

## Source map

| Surface | Implementation |
| --- | --- |
| Shared contract | `src/shared/aws.ts` |
| Pinned manifest | `src/core/aws/manifest.ts` |
| Download, verification, install, cache | `src/core/aws/service.ts` |
| Dependency-manager adapter | `src/core/aws/dependency-manager-adapter.ts` |
| Desktop and browser RPC | `src/core/aws/register-ipc.ts`, `src/shared/ipc.ts` |
| Desktop bridge | `src/preload/index.ts` |
| Browser bridge | `src/renderer/bridge/ws-bridge.ts` |
| UI | `src/renderer/components/aws/AwsCliManagerPanel.tsx` |

## Verification state

This lane adds the implementation and documentation contract. The integration owner must regenerate
the offline documentation bundle and run the repository's normal local checks before publishing a
release. No claim of packaged-artifact interaction or runtime capture is made by this source-only
change.

Suggested articles: [Ollama manager](../../ollama-manager.md), [scheduled settings](../../scheduled-settings.md),
and [local history](../../local-history.md).
