# GitHub work-item canvas nodes

GitHub issues and pull requests can be represented as first-class canvas nodes. The node is a safe
portable projection: repository, number, kind, title, normalized body Markdown, author, labels,
review/check summaries, timestamps, URL, refresh state, and explicit session attachments are kept.
Credentials, provider sessions, raw responses, local paths, and unpublished drafts never enter the
project file, export, log, or relay payload.

## Guided lifecycle

Creation starts from the Node Catalog. The repository and item are selected through the existing
approved GitHub account and typed API capability services. Refresh is bounded and preserves the last
safe snapshot when the account is offline or lacks permission. Open, comment, and navigation actions
must use the existing reviewed operation catalog and its host-owned credential boundary.

Session relationships are never inferred from terminal or conversation text. A user may explicitly
attach a session, or the app may attach one only after it verifies that an app-owned GitHub operation
created or modified the item. Relay and Server Edition hosts expose the same typed bridge and report
an honest unsupported or unavailable state when no authenticated host route exists.

The card renders provider-authored Markdown through the shared isolated renderer. Search remains
local and plain-text-first, with the app's anchored full regex builder beside the field. Item state,
author, labels, reviews, checks, and timestamps are facts from the normalized provider response,
never guessed from a title or URL.

## Verification boundary

This source lane intentionally did not run tests, lint, type checking, builds, packaging, runtime
interaction, reviews, audits, debugging, repairs, or HuiShots. Those checks belong to the owning
integration task.

Suggested articles: [Guided GitHub API capabilities](github-api.md), [GitHub CLI account selector](github-cli-accounts.md), and [Canvas node kinds](../canvas/node-kinds.md).
