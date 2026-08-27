# Wild dim sum node

The Wild dim sum node is a guided canvas surface backed only by the public
[`Ding-Ding-Projects/dim-sum-photos`](https://github.com/Ding-Ding-Projects/dim-sum-photos)
catalog and its published release photos. It does not copy, generate, download into the project,
or vendor a photo.

## Behaviour

Create the node from the Unified Node Catalog. It loads the canonical public `catalog/index.json`
through a bounded, cancellable request, validates every display record, and exposes two deliberate
choices: select a random published dish or search the published inventory. Search is plain text by
default and has an adjacent anchored full regex builder. Each result is a keyboard-operable button
showing the authoritative English and Traditional Chinese names plus its category.

Selecting a dish displays its bilingual name, descriptions, category, subcategory, alt text, and
published release photo. A photo failure leaves the selected text visible and offers a retry. A
catalog failure leaves an existing selection intact and names the recovery action. Disabled actions
explain that catalog loading must finish first.

## Portable and local state

Schema 3 stores only the validated public identity and display fields: dish id, slug, bilingual
name, category, subcategory, bilingual description, image asset path, and bilingual alt text. Layout,
title, color, grouping, and relationships use the ordinary portable node fields. Another computer
can reopen the selection without deployment, provider mutation, process launch, or downloading a
project asset.

The public response bytes, release photo bytes, browser cache, request progress, cancellation state,
errors, and generated image URL are deliberately omitted. Credentials, provider sessions, machine
paths, process state, host identifiers, and private caches never enter the node or schema 3. Import
only hydrates safe presentation intent. It performs no network request and starts no process.

## Availability and release assets

The node itself is always creatable. Live catalog and photo display require network access to the
canonical raw catalog and GitHub release asset hosts. Offline use keeps a previously selected dish's
portable text and reports that refresh is unavailable. There is no bundled or installer-owned photo
asset for this feature.

## Accessibility and localization

The surface uses the app's Material Design 3 roles, light and dark tokens, visible focus, resizable
node chrome, scroll-bounded results, native progress semantics, and keyboard-operable controls. Core
control copy is available in English and playful Hong Kong-style Cantonese through the shared
language catalog. Dish names remain the public catalog's factual bilingual names at every funny
level.

School mode removes the catalog entry and all dish copy, imagery, search, and network activity.
An already-persisted node renders only a neutral optional-feature placeholder until the mode is off.

## Failure modes and security

- Catalog responses above 12 MiB, over 4,000 entries, malformed JSON, invalid fields, unexpected
  image paths, or non-published dish identities are refused as a whole.
- Loading can be cancelled. Retry starts one new bounded request and does not duplicate a node.
- Search evaluation uses the existing bounded regex engine and fails open with a visible pattern
  error rather than hiding results.
- Photo URLs are derived only from a validated dish id and image filename, then mapped to one of the
  three known public catalog release tags.
- The node accepts no arbitrary URL, shell text, request editor, credential, provider binding, or
  local path.

## Verification status

This ultra-speed implementation lane intentionally ran no tests, type checks, lint, builds,
packaging, runtime interaction, accessibility or security audits, reviews, or captures. Those
verdicts remain unverified and belong to the parent integration lane.

## Suggested articles

- [Unified Node Catalog](./node-catalog.md)
- [Canvas and node lifecycle](./canvas-and-lifecycle.md)
- [Portable canvas projection](../projects/portable-canvas-projection.md)
