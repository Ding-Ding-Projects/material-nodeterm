# CloudFormation manager

The CloudFormation manager is a canvas service node that keeps stack and template operations
guided. It discovers the locally available AWS CLI, lists stacks for a selected profile and region,
validates a local YAML or JSON template, and creates a CloudFormation change set so the user can
review resource-level changes before any deployment action.

## Scope and safe boundaries

- The manager invokes the AWS CLI with an argument array and never starts a shell.
- The CLI is resolved from the packaged `aws-cli` resource or the user-scoped AWS tools directory;
  the status surface identifies whether the bundled or PATH copy is active.
- Profiles and regions are selected from detected lists. Stack names, change-set names, template
  paths, and parameter values are validated again at the operation boundary.
- Templates are local files. The manager verifies an absolute readable file before passing its
  `file://` URL to the AWS CLI. It does not copy credentials, profile files, role sessions, or
  provider caches into a project file.
- Importing or reopening a project carries only the safe `CloudFormationPortableBlueprint` intent:
  stack name, change-set type, parameter keys, and capabilities. The profile, region binding,
  template path, CLI path, account, and credentials remain local and must be selected again.

## Guided workflow

1. Choose an AWS profile and region from the detected lists. An empty or unavailable list reports
   the exact missing AWS CLI or profile state instead of inventing a value.
2. Choose a local template with the Browse control, then inspect it. CloudFormation's own
   `validate-template` response supplies parameter names, descriptions, defaults, and capabilities.
3. Choose Create or Update, a stack name, a change-set name, parameter values or Use previous, and
   any required capability acknowledgement.
4. Select Preview change set. The manager creates the change set and polls its status with a bounded
   timeout, showing the real status and resource changes. The preview is not a deploy and cannot
   mutate the stack beyond the provider's change-set creation operation.
5. Cancel a running preview with the Cancel control. A cancelled child process is not reported as
   a successful preview, and a timed-out or malformed response remains an explicit error.

Every search field in the node has its own anchored full regex builder. Stack, profile, and region
searches remain plain-text by default, with regex enabled only by an explicit user action.

## Failure modes and recovery

- Missing AWS CLI: install or repair the bundled AWS CLI through the AWS tools manager, then retry.
- Malformed or over-sized CLI output: the operation refuses the response and reports the bounded
  output limit; no partial preview is shown.
- Missing, non-absolute, unreadable, or invalid template path: choose the file again with Browse.
- Invalid profile, region, stack, change-set, parameter, or capability: the request is rejected
  before the AWS CLI is invoked.
- AWS authentication, network, quota, or provider errors: the CLI error is shown as a non-blocking
  error state and no deployment is attempted.
- Preview cancellation or timeout: the child process is stopped and the user can retry after
  checking account access and network availability.

## Portability and local state

The safe blueprint is exported with the schema 3 project projection. It intentionally excludes
profiles, account identity, credentials, local file paths, provider session state, CLI paths, and
change-set ids. On another computer the node remains an explicit Configure or Rebind state until
the user selects a local profile, region, and template.

## Surface availability

The Windows desktop surface is the active implementation for this lane. The Server Edition and
mobile companion do not expose this provider operation yet, so they must show an explicit
unavailable state rather than a fake manager or a local-machine fallback. The shared blueprint
shape is ready for a later host-owned implementation.

## Verification boundary

This ultra-speed implementation lane did not run unit tests, type checks, lint, security checks,
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
The implementation and documentation are present, but those Chuts remain unverified. Build and
packaging work, if performed by the release owner, proves artifact production only and does not
prove runtime correctness.

## Suggested articles

- [Special-universe Shop nodes](aws-universe-shop.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
- [AWS Universe plan](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
