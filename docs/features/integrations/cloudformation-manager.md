# CloudFormation manager

The CloudFormation manager is a guided, local control surface for AWS CloudFormation. It keeps the
renderer on structured requests and lets the trusted core invoke only the fixed AWS CLI operations
needed by this feature. It never accepts a shell command, a raw argument vector, or a free-form
request body.

## Template and account setup

Open **Tools → CloudFormation manager**, choose a detected AWS profile and region, then choose a
JSON or YAML template with the native file picker. The template is held in memory for this review;
it is bounded to 1 MiB and is not written into a project file. The core sends it to
`cloudformation validate-template` through a short-lived private file and removes that file when
the request ends. A missing AWS CLI, incomplete profile, invalid region, malformed template, or
oversized template remains an explicit error with a retry path.

The stack picker lists the stacks reported by the selected account and region. A new stack name can
be entered only through the validated name field. Profile and region are always included in each
request, so changing the active project or session cannot make an operation run against an
unintended account.

## Parameters, capabilities, and tags

After validation, the manager turns the template's parameter declarations into labelled controls,
including a **Use previous value** choice for updates. Capabilities are explicit checkboxes for
`CAPABILITY_IAM`, `CAPABILITY_NAMED_IAM`, and `CAPABILITY_AUTO_EXPAND`. IAM capabilities explain
that permissions must be reviewed before the change set is created. Tags are entered as key/value
pairs and are sent as structured AWS options. No parameter or tag is interpreted as a command.

## Change-set review

Choose **Create reviewed change set** to create a named `CREATE` or `UPDATE` change set. The manager
fetches the resulting description and shows the exact resource rows returned by CloudFormation:

| Column | Meaning |
| --- | --- |
| Action | Add, Modify, Remove, Import, or Dynamic |
| Logical resource | The template logical ID |
| Type | The AWS resource type |
| Replacement | The service's replacement decision |
| Details | Change source, evaluation, and causing entity where reported |

IAM resources and service capability warnings remain above the table. An empty change list is
reported as empty, not as success. The preview can be refreshed before execution.

## Reviewed execution and recovery

Execution is offered only when the change set status is `CREATE_COMPLETE` and the execution status
is `AVAILABLE`. Change sets containing a removal or a resource replacement use the application's
two-key destructive confirmation flow, including the exact affected logical IDs. The AWS execute
request is not made until both keys and the full-range slider complete. Cancelling leaves the
change set untouched.

The Events tab reads `describe-stack-events` and shows status, timestamp, resource, and the service
status reason. The waiter control uses the matching CloudFormation waiter for create or update,
with a bounded timeout. In-progress, failed, rollback, and timed-out states remain visible with
the latest events and an actionable error. A failed read is never presented as an empty event list
without its error state.

## Persistence and portability

The selected profile, region, template bytes, parameters, tags, change-set identity, stack events,
and AWS credentials are runtime data. They do not enter the shared project projection, exports,
logs, or canvas files. A portable project can retain only safe display intent, never account
credentials, role sessions, host paths, cached responses, or process state. Reopening on another
computer starts with an explicit profile and region selection rather than silently reusing a
machine-local identity.

## Surfaces and boundaries

- **Desktop:** full manager surface through the Electron preload and the core CloudFormation
  service.
- **Server Edition:** the same structured API is available through the WebSocket bridge and uses
  the server's own AWS CLI installation and credentials. It does not fall back to the browser
  computer.
- **Mobile companion:** no CloudFormation execution surface is exposed. A future companion can
  show a read-only status summary after a separate protocol contract is agreed.

## Verification boundary

The implementation includes the shared request and result contract, fixed core command routing,
preload and Server Edition bridges, guided form, exact change preview, IAM warnings, event reader,
bounded waiter, and destructive confirmation integration. This ultra-speed lane intentionally did
not run tests, type checks, lint, security checks, accessibility checks, installer execution,
runtime interaction checks, or screen captures. Build and packaging evidence, when produced by the
release process, proves artifact production only.

## Suggested articles

- [Service nodes](service-nodes.md) — canvas integration patterns for external managers.
- [Portable canvas projection](../projects/portable-canvas-projection.md) — what may travel with a
  project and what must stay machine-local.
- [Destructive confirmation](../../destructive-confirmation.md) — the two-key confirmation flow
  used for removals and replacements.
- [AWS and hosting program](../../plans/2026-08-26-portable-node-universes-and-hosting-program.md)
  — the parent roadmap for the AWS manager family.
