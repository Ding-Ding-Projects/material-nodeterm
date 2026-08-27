# AWS Universe portal

The AWS Universe portal creates an independent child canvas for each AWS workspace in a project.
Instances are direct children of the project root and have no product depth ceiling. Each child
starts with one permanent, scope-bound Shop node. The portal and Shop carry AWS-only scope metadata,
so a general or non-AWS node cannot be created through this route.

## Creating and navigating

Open the AWS Universe navigator in the canvas app bar, search the current instances, or choose
**New AWS Universe**. The name is required and is validated before a new instance is published.
The navigator uses plain-text search by default and has its own anchored full regex builder. A
portal card on the root canvas opens the selected child canvas and returns through the navigator.
The child canvas shows its AWS-only scope and its fixed Shop entry point.

## Portability

The shared project file and portable schema 3 projection preserve the instance id, display name,
order, viewport, safe node intent, relationships, and Shop metadata. Provider credentials, profiles,
SSO sessions, role sessions, CLI paths, local files, process state, caches, and account bindings are
never written to project content. A copied project therefore opens with AWS intent and asks for local
configuration through the later identity and operation lanes.

Import validates the bounded envelope, rejects malformed identifiers and canvases, reconstructs
AWS child membership, and performs no provider call, process launch, deployment, download, or other
external side effect. Relationship records are tagged with their owning canvas and must remain
inside that canvas.

## Availability and recovery

An empty or control-character name is refused with an inline next action. Unknown or duplicate
instance identifiers are ignored during safe file loading, while the portable validator refuses
invalid structures rather than guessing. The fixed Shop is rebuilt by the existing special-universe
repair path when an imported child is missing it. The resource safety bound is an implementation
limit for hostile input protection, not a user-facing cap on AWS Universe instances.

## Accessibility and privacy

The navigator is keyboard-operable, exposes listbox and option states, restores focus through the
anchored popover, and labels its search and regex-builder controls. Portal cards expose a named open
action. Credentials and machine identity remain in private local application data, never in the
portable file, logs, exports, or provider records.

## Verification boundary

Issue #39 is an ultra-speed implementation lane. Tests, type checks, lint, reviews, security checks,
accessibility checks, builds, packaging, installer execution, runtime interaction, and UI captures
were intentionally not run. This source and documentation change is implementation evidence only.

## Suggested articles

- [Special-universe Shop nodes](../integrations/aws-universe-shop.md)
- [Portable schema 3](../projects/portable-schema3.md)
- [Unified Node Catalog](./node-catalog.md)
- [Canvas and node lifecycle](./canvas-and-lifecycle.md)
