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

