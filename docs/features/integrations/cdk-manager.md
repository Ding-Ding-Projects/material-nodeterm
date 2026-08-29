# AWS CDK manager

The AWS CDK manager provides a guided local workflow for an AWS Cloud Development Kit project. It
starts with a native project-folder picker, inspects the selected root, shows the detected
application name, language and runtime, and presents a trust review before any CDK command runs.
The surface is available from Tools → AWS CDK manager and from the `Ctrl+Shift+F` command palette.

## Behaviour

The manager recognizes `cdk.json`, reads the declared `app` entrypoint, and discovers the relevant
dependency manifests without executing them. It reports TypeScript, JavaScript, Python, Java, and
C# projects when their entrypoint or manifest makes that clear. Missing or malformed evidence is
reported as an explicit finding, never as a guessed language or a clean review.

Bootstrap is the only dependency-changing action. It runs the project-local package manager with
`--ignore-scripts` and pins the CDK toolkit to the application-approved `2.176.0` version. The
manager then checks the local toolkit package and marks it verified only when the installed version
matches the pin.

Synth, diff, deploy, and destroy are typed actions. There is no arbitrary shell field. Each action
uses the project-local `cdk` executable, a fixed argument list, the selected folder as its working
directory, and a bounded output collector. Synth and diff also report the generated `cdk.out`
assets, including byte count and SHA-256. Output is capped at 2 MiB and each reported asset at 16
MiB; truncation or an omitted oversized asset is labelled rather than hidden.

Deploy and destroy require a current trust fingerprint plus an explicit acknowledgement in the
Trust review tab. If the folder, entrypoint, manifests, or findings change, the fingerprint changes
and the old acknowledgement cannot authorize a new operation. Informational progress and failures
are non-blocking notifications, the active operation can be cancelled, and the Output tab remains
available for review.

## Portability and persistence

Only the user's safe project intent belongs in the portable project projection. This manager keeps
the selected folder, process state, generated output, AWS credentials, provider sessions, caches,
and machine-specific identifiers local to the shell's application data and never writes them into a
transferable project file. Reopening a projection on another computer therefore requires the user
to Configure or Rebind the local folder again before operating it. Import has no network, deploy,
provider, process, or download side effect.

## Security and failure modes

The trust review rejects shell metacharacters in `cdk.json`'s app entrypoint and reports unreadable
manifests. Commands are launched with `shell: false` and no caller-supplied executable or argument
array. A missing `cdk.json`, missing local toolkit, unsupported language, failed command, non-zero
exit, output truncation, or asset limit is shown as a concrete state with a recovery action.
AWS credentials are not requested, persisted, printed, included in output, or copied to project
data by this feature. The app's existing credential and destructive-action surfaces remain the
place for those concerns.

The desktop and Server Edition use the same core manager through their respective IPC boundaries.
Relay sessions deliberately keep this machine-local capability unavailable rather than silently
running AWS commands on the wrong computer. The mobile companion has no direct CDK process surface;
its follow-up is to present the same project status and a Rebind route over its existing transport.

## Verification notes

The feature has been wired through the shared types, desktop preload, Server Edition bridge, core
registrar, and renderer drawer. This ultra-speed lane intentionally does not run tests, type checks,
lint, security checks, accessibility checks, installer execution, runtime interaction checks, or UI
captures. Build and packaging evidence, when produced by the owning release pass, proves artifact
production only and does not prove this manager's runtime behaviour.

## Suggested articles

- [Service nodes](service-nodes.md) — how integrations appear beside terminals on the canvas.
- [Portable canvas projection](../projects/portable-canvas-projection.md) — safe project intent and
  machine-local rebind behaviour.
- [In-app documentation](../help/in-app-documentation.md) — the offline documentation browser used
  to read this article inside the desktop build.
