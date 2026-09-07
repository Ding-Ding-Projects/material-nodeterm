# Packaged gallery launcher

`scripts/run-headless-gallery.mjs` binds a packaged candidate to its source provenance and launches
it on one owned hidden desktop through the persistent Lowlevel MCP transport. It requires absolute
candidate, repository, provenance, tool, and output paths. The run directory must be outside the
repository. Execution additionally requires an explicit capture script and JSON argument file.

## Isolation and lifecycle

The launcher keeps one initialized MCP session for the entire operation. A PowerShell 7 wrapper
sets process-local profile and temporary directories and records its own identity plus its child
identity before capture proceeds. The production wrapper currently requires
`%ProgramFiles%\PowerShell\7\pwsh.exe`; an absent executable is an explicit unsupported environment,
not permission to launch with the user's active profile. The test fixtures resolve an installed
PowerShell 7 runtime and can exercise portable installations.

Ownership includes PID, parent PID, executable path, and invariant UTC creation ticks. The ledger
checks descendants, rejects identity replacement, verifies the selected debugging listener, and
terminates children before their parent. An unavailable identity, ambiguous listener, changed
window, incomplete launch receipt, or unproven process exit retains the affected resources and
records the failure. Never replace that behavior with a process-name termination sweep.

## Verification and remaining evidence

```text
npx vitest run scripts/run-headless-gallery.test.mjs scripts/lib/gallery-process-lifecycle.test.mjs
```

The integration pass ran 6 launcher tests and 7 lifecycle tests successfully. The latter include
actual process creation and teardown, stable identity across PowerShell versions, and recovery
when the launch response is lost. These checks do not constitute a new packaged application
capture. Full gallery execution, final capture receipts, and design-reference parity remain tracked
in issue #222. Keep private profiles and temporary fixture output out of published evidence.
