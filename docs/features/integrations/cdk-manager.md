# AWS CDK manager

The AWS CDK manager is a local, review-first mode of the shared AWS resource manager for an existing
CDK project. It uses that manager's local profile, region, and credential binding, selects a project
directory with the native folder picker, reads `cdk.json` without executing it, presents a trust
review, runs `cdk synth`, shows the synthesized stacks, opens `cdk diff`, and permits deploy only
after the user acknowledges the exact diff. CDK code runs only after the trust acknowledgement.

## Operation

1. Choose the folder containing `cdk.json` with **Browse**.
2. Select **Inspect project**. The manager reads bounded project metadata and lists the app command,
   context keys, and known manifest files.
3. Read the trust warnings and select the acknowledgement checkbox. **Approve trust review** grants
   permission for this app session only.
4. Select **Synth**. Generated templates are kept in a temporary local directory and removed after
   their names and stack list are collected.
5. Select stacks from the synthesized list, using the local search field when needed, then choose
   **Open reviewed diff**.
6. Read the complete diff and acknowledge it. If removal or replacement changes are detected, the
   existing two-key destructive confirmation surface is required before deploy.
7. Select **Deploy reviewed diff**. The manager reruns only the fixed CDK `deploy` subcommand with
   the reviewed stack set and records the returned outputs locally.

All long-running operations expose a real progress state and a cancel action. Operation output is
bounded, command execution does not use a shell, and the CLI path is resolved from the bundled tool
location or the user's executable search path. A missing CLI reports the exact repair action instead
of showing a pretend ready state.

## Portability and local data

The portable project projection may contain only safe intent: an app intent label, selected stack
names, and context-key names. It must not contain the selected folder path, CDK context values,
credentials, profiles, provider sessions, generated templates, process ids, caches, or command
output. A destination computer must select and review its own local folder before running CDK.

Trust and diff review tokens are in-memory, expire after a bounded period, and are scoped to the
exact resolved folder and stack set. A stale token cannot authorize another project or a changed
stack selection. Importing a portable project is data-only and does not call CDK, contact AWS,
deploy, download, or launch a process.

## Accessibility and search

The panel uses the shared Material Design 3 tokens and controls, visible focus, keyboard-operable
buttons and checkboxes, labelled status regions, an internally scrolling diff, and a responsive
layout. The synthesized-stack search is plain text by default and has its own adjacent anchored
full regex builder. Empty, unavailable, invalid, cancelled, and partial states remain visible with
an actionable message.

## Failure modes and recovery

- A folder without a bounded `cdk.json` is rejected before any command runs.
- A missing or unreadable CDK CLI reports that the bundled tool must be installed or repaired.
- Trust approval is required again when the in-memory review expires or the folder changes.
- Oversized output is cancelled and reported rather than truncated into a misleading result.
- A cancelled synth, diff, or deploy leaves the project unchanged by this manager.
- Removal or replacement changes require the existing two-key confirmation flow.
- Deploy is refused when no fresh diff review exists for the same project and stack selection.

## Verification boundary

This implementation lane intentionally did not run tests, type checks, lint, security checks,
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
The code and documentation are present, but those checks remain unrun and no packaging result is
evidence of runtime correctness.

## Suggested articles

- [AWS Universe Shop nodes](./aws-universe-shop.md)
- [Portable project schema 3](../projects/portable-schema3.md)
- [Destructive confirmation](../../destructive-confirmation.md)
