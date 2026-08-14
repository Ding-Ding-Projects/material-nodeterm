# Usage Popover Account Default Design

## Goal

Let a user choose the active project’s default Claude identity directly from the usage popover. The choice applies only to new Claude sessions. Existing nodes and running sessions keep the account identity resolved when they were created.

## Scope

The change covers local projects and SSH projects in the desktop and Server Edition renderer. Mobile remains unchanged. Non-Claude provider sections remain read-only.

The feature uses the existing `Project.defaultAccountId` field and `useProjects.setProjectDefaultAccount` action. It does not introduce a global active account, change account credentials, or mutate existing node `accountId` values.

## Interaction

When the popover contains more than one local Claude identity, each existing account block becomes a full-width button. Remote Claude identity blocks use the same treatment on an SSH project.

The active default shows a check marker in its account header. Each button exposes pressed state to assistive technology and uses a tooltip that distinguishes “Default for new sessions” from “Use for new sessions”. Clicking an identity keeps the popover open so the check marker moves immediately and the user can compare the usage rows again.

The System identity maps to an undefined `defaultAccountId`. A managed identity maps to its existing account ID. An unavailable remote row remains hidden and cannot be selected. Billing-provider blocks do not gain account-selection behaviour.

## State and persistence

`UsageIndicator` already subscribes to the active project ID and account scope. It will additionally subscribe to the active project’s `defaultAccountId` as a primitive value.

On selection, the component reads the current active project ID, calls the existing project-store action with the selected account ID, then calls the shared workspace-dirty seam. Canvas already owns that seam and persists the full project snapshot through the same debounced save used by other renderer surfaces outside Canvas.

The handler guards an empty active project ID. A project switch re-renders the popover under the new project scope and default. No asynchronous account operation or new error state is required because the state update is synchronous and the existing workspace persistence path owns disk-write handling.

## Component boundaries

`AccountUsageBlock` will accept the identity ID, selected state, and selection callback while continuing to render the existing usage details.

`RemoteUsageBlock` will pass its nullable `accountId` through the same selection contract after mapping null to the System identity.

`UsageIndicator` will own the active-project mutation and persistence signal. The usage service, preload API, shared project types, and TabBar account menu remain unchanged.

## Styling

The existing account block supplies spacing and separators. A selectable modifier will reset native button chrome, preserve typography and alignment, add a subtle hover and keyboard-focus surface, and place the check marker at the end of the account header. The whole usage block remains the target, avoiding repeated action text beside every limit.

## Verification

A jsdom component test will mount the real `UsageIndicator` with controlled usage API responses and real Zustand project and settings stores.

Coverage will prove the following behaviour.

- A local managed-account click sets the active project default and moves pressed and checked state from System to that account.
- Clicking System clears the default.
- Existing nodes retain their original `accountId` values.
- An SSH managed-account row uses its remote account ID and its System row clears the default.
- Each selection schedules workspace persistence once.
- Provider blocks remain non-selectable.

The test must fail against the display-only implementation before production code is changed. Final verification includes the focused component test, typecheck, production build, full suite with local-socket permission, diff checks, and a fresh review against issue 142.
