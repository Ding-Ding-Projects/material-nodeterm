# GitHub work-item canvas attachments

GitHub issues and pull requests are compact attachments on the canvas. A work item renders as a
chip on the exact attached session node and as a pill on its owning group frame. There is no new
pull-request or issue node kind for new work. The attached record is the single source of truth for
the node chip and frame pill, so the two surfaces cannot disagree about repository, number, title,
state, labels, review/check summaries, timestamps, URL, or refresh state.

Existing `github-work-item` nodes remain readable as legacy detail cards. They are never silently
discarded: a record with an exact attachment identity can migrate to the compact attachment shape,
while a record without one stays as a full detail card until the user explicitly attaches it.
Credentials, provider sessions, raw responses, local paths, and unpublished drafts never enter the
project file, export, log, or relay payload.

## Guided lifecycle

Attachment starts from the exact session node context and uses the existing approved GitHub account
and typed API capability services. The Node Catalog no longer creates a standalone work-item node.
Refresh is bounded and preserves the last safe snapshot when the account is offline or lacks
permission. Open, comment, and navigation actions must use the existing reviewed operation catalog
and its host-owned credential boundary.

Session relationships are never inferred from terminal or conversation text. The attached node id
is explicit app-owned data. A frame may adopt a pull request only when its provider head ref exactly
equals the app-owned worktree branch for that frame. Missing head-ref or branch data leaves adoption
explicit and guided. Relay and Server Edition hosts expose the same typed bridge and report an honest
unsupported or unavailable state when no authenticated host route exists.

The legacy detail card renders provider-authored Markdown through the shared isolated renderer. The
compact chip and pill are links into the reviewed detail route and remain keyboard and screen-reader
operable. Search remains local and plain-text-first, with the app's anchored full regex builder
beside the field. Item state, author, labels, reviews, checks, and timestamps are facts from the
normalized provider response, never guessed from a title or URL.

## Verification boundary

This source lane intentionally did not run tests, lint, type checking, builds, packaging, runtime
interaction, reviews, audits, debugging, repairs, or UI captures. Those checks belong to the owning
integration task.

Suggested articles: [Guided GitHub API capabilities](github-api.md), [GitHub CLI account selector](github-cli-accounts.md), and [Canvas node kinds](../canvas/node-kinds.md).
