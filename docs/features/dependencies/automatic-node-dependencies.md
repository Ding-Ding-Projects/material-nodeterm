# Automatic node dependency installation

## Behaviour

Node features select dependencies by immutable manifest identifier. The shared manifest records the
exact version, platform, architecture, canonical HTTPS source, SHA-256, optional packaged source,
archive format, expected files, unpacked-size budget, license and redistribution status, install
mode, health probe, and repair strategy. A feature never supplies a download URL, executable path,
mirror, or shell command from a project file or a renderer form.

The first foundation entry is the portable Node.js runtime. It is selected by `node-runtime`, the
host platform, and the host architecture. A supported entry is installed beneath the app's local
application-data directory. It is not discovered through `PATH`, and an unrelated executable with
the same name cannot make the dependency appear ready.

The lifecycle reports these bounded states:

`missing` → `checking` → `downloading` → `verifying` → `installing` → `ready`

Repair uses `repairing` and the same verified publication path. Cancellation, unavailable platform
data, and errors finish in `cancelled`, `unavailable`, or `failed`. A state is not reported as
`ready` until the expected files exist in the published directory and the fixed health probe passes.

## Configuration and integration

`dependencies.manifest.json` is the human-auditable root manifest. The platform-free runtime
contract is in `src/shared/node-dependencies.ts`, and `src/core/node-dependencies/service.ts`
owns the privileged lifecycle. `registerNodeDependencyIpc` registers the same typed channels on
the Electron desktop host and Server Edition host. The browser talks to the Server Edition through
the existing authenticated WebSocket bridge; it never downloads or extracts a binary itself.

Node Catalog entries should declare these manifest identifiers and use the returned `disabledReason`
when a dependency is absent. On a successful `install`, the caller receives an operation identifier
and a verified availability record, then can resume the interrupted node or hosting wizard without
recreating its form state. Progress is broadcast with completed bytes, total bytes when the source
reports one, and the current lifecycle state.

## Failure modes and recovery

Downloads are limited to a bounded number of HTTPS redirects on the canonical source origin, a
bounded response size, and a bounded request duration. A response with a missing body, bad status,
oversized content, non-canonical redirect, or timeout fails before publication. The archive is
written to a unique machine-local staging file, hashed before extraction, and removed on failure.

Verified archives are reused from the app-local cache after their digest is checked again. A stale
or corrupt cache is discarded and downloaded again. Extraction rejects traversal, symbolic links,
unsupported archive entries, and an unpacked-size limit. Files are extracted into a unique staging
directory; publication moves an existing installation aside, publishes the verified directory, runs
the health probe against its absolute path, and restores the prior installation if publication or
the probe fails.

Restart reconciliation rechecks every persisted `ready` record. Missing files or a failed probe
become an explicit repair-needed state rather than an empty success. A cancelled operation keeps
resume metadata honest, but Node.js ZIP downloads do not claim byte-range resumption; the verified
cache is the restart path.

## Security and privacy

Only manifest entries can reach the downloader. Sources must be canonical HTTPS URLs without
embedded credentials, redirects cannot leave the source origin, and no user-entered URL or mirror
is accepted. The service never invokes a shell and health probes use a fixed executable path and
fixed manifest arguments. No administrator authority is requested for the portable user-scoped
route.

Install records, cache files, staging directories, and executable paths live only under the host's
application-data directory. They are not placed in a project, portable archive, workspace record,
environment variable, or log. No credentials, signing material, or command arguments containing
secrets are used. The Server Edition performs installation on the machine running that host, while
a browser-only client receives the host's typed status and exact unavailable reason.

## Verification

The implementation surface is intentionally testable without a UI: manifest entries are typed,
transitions are bounded, source validation is canonical, downloads are size- and time-bounded,
hashes are checked before install, extraction is staged, publication is atomic, and readiness uses
the fixed probe rather than `PATH`. Focused lifecycle and IPC tests remain an integration point for
the next verification wave.

## Suggested articles

- [Projects and tabs](../projects/projects-and-tabs.md), for node creation and wizard state.
- [File converter](../../file-converter.md), for the same bundled-adapter and unavailable-reason
  contract.
- [Windows support](../../windows-support.md), for the active desktop host boundary.
- [Packaging and auto-update](../packaging/packaging-and-auto-update.md), for packaged-resource
  resolution and release evidence.

## Bundled AWS CLI v2

AWS features use the manifest identifier `aws-cli-v2`. The Windows x64 entry pins AWS CLI v2
`2.36.32`, its official versioned MSI URL, the SHA-256 digest, the expected payload files, and a
bounded download size. The application does not accept a user-supplied URL, executable path,
mirror, shell command, or PATH lookup for this dependency.

The Windows installer preparation step runs
`scripts/ensure-aws-cli-resources.mjs` before packaging. It reuses a matching local resource or
fetches the official MSI over HTTPS, refuses redirects, limits the response to 64 MiB, verifies
the pinned SHA-256, and publishes through a unique staging file. A mismatched or incomplete
download is deleted before it can reach packaging.

At runtime, the dependency service checks the packaged resource first, then a verified local cache,
then the canonical download fallback. It records whether the ready payload came from the bundled
resource, a verified cache, or a verified download. The MSI is extracted into a unique application
data staging directory through `msiexec.exe /a`; no machine-wide installation or PATH mutation is
performed. The expected `aws.exe` health probe must report the pinned `aws-cli/2.36.32` prefix
before the installation becomes ready.

## Version and model inventory

The typed `nodeDependencyDetails` route reports the raw version output and the parsed semantic
version. For AWS CLI v2 it also walks the installed `awscli/botocore/data` tree and returns a
sorted service inventory. Each service record contains its model versions and the number of
matching `service-2.json`, `service-2.sdk-extras.json`, and compressed model files. The response
includes the total model count, a completion flag, and an exact error when the tree is missing,
empty, or exceeds its service or file limits.

The inventory is derived from the installed payload rather than from a hand-maintained service
list. This lets later AWS service and wizard surfaces use the exact models carried by the installed
CLI while keeping the model data local to the host.

## Configuration and persistence

The human-auditable dependency record is in `dependencies.manifest.json`. The platform-neutral
contract and AWS entry are in `src/shared/node-dependencies.ts`. Install records, cache files,
staging directories, executable paths, and archive provenance are stored below the host's
application-data directory by `src/core/node-dependencies/service.ts`.

The desktop host registers the typed details route in `src/core/node-dependencies/register-ipc.ts`.
`src/preload/index.ts` exposes it to the desktop renderer, and
`src/renderer/bridge/ws-bridge.ts` exposes the same host-owned result to the Server Edition.
The renderer never downloads, extracts, or executes the AWS CLI itself.

## Failure modes and recovery

- A missing packaged MSI falls back to the verified cache or the canonical HTTPS source.
- A corrupt, stale, oversized, redirected, or digest-mismatched archive is refused before
  extraction.
- An MSI that lacks `aws.exe` or the expected model index remains unavailable and reports the
  missing payload rather than publishing a partial installation.
- A version probe that does not begin with `aws-cli/2.36.32` remains unavailable and reports the
  observed version when the details route is requested.
- A missing or empty model directory reports an incomplete inventory with a recovery reason. A
  bounded inventory failure never becomes a complete model catalogue.
- Restart reconciliation rechecks the installed executable and converts a failed probe into an
  explicit repair-needed state.

## Security and privacy

Only immutable manifest data reaches the downloader or MSI extractor. Sources must be canonical
HTTPS URLs without embedded credentials, and redirects cannot leave the source origin. The service
uses `execFile` with fixed arguments, never a shell, and does not invoke a user-selected executable.

The AWS CLI archive and extracted payload remain machine-local. No AWS profile, access key, session,
credential file, endpoint, command argument, environment value, model payload, or private path is
placed in a project export, portable blueprint, log, telemetry, or public record by this lane.

## Portability

Portable projects store AWS operation intent only in later AWS lanes. They do not carry the local
AWS CLI installation, cache, executable path, model payload, profile, credentials, or host-specific
runtime state. A destination computer must use its own local dependency record and an explicit
Configure or Rebind flow before executing AWS operations.

## Verification status

The feature fetch path retrieved the pinned 49,405,952-byte MSI and matched SHA-256
`bc695531b7fd83490e02741777dfda109cfab7fd9bef85fa1d5db21684cbaee2` on 2026-08-27. The
ultra-speed implementation boundary did not run tests, type checks, lint, reviews, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
Those checks remain pending for the integrated desktop surface and packaged installer.

## Suggested articles

- [Automatic node dependency installation](./automatic-node-dependencies.md), for the shared
  lifecycle, cache, repair, cancellation, and restart contract.
- [Node Catalog](../canvas/node-catalog.md), for guided dependency-aware node creation.
- [AWS Universe Shop](../integrations/aws-universe-shop.md), for the AWS-scoped node catalogue.
- [Packaging and auto-update](../packaging/packaging-and-auto-update.md), for packaged resources
  and unsigned installer evidence.
