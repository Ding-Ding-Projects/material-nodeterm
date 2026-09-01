# Personal vocabulary coverage for tools and documentation

The local personal-vocabulary file is applied at the final renderer boundary for application-authored
copy in the tool and documentation surfaces listed below. The file is never sent across the bridge,
stored in a project file, included in an export, or applied to user data, provider-authored content,
paths, identifiers, commands, or machine output.

## Covered surfaces

| Surface | Boundary | Content intentionally left exact |
| --- | --- | --- |
| Regex builder and anchored trigger | `useVocabularyMapper()` around labels, hints, statuses, and accessible names | Pattern text, flags, engine identifiers, sample text, limits, and generated match data |
| Context menu and command palette | `useVocabularyMenuItems()` and `useVocabularyCommands()` | Actions, shortcuts, identifiers, values, colors, and command bodies |
| Changelog and release cards | Mapper on app-owned chrome and action labels | Release versions, dates, commit SHAs, commit URLs, and release bullet Markdown |
| Local history | Mapper on filters, statuses, action chips, and controls | Revision SHAs, timestamps, filenames, and recorded mutation facts |
| Offline documentation | Mapper on browser chrome and link titles | Bundled article paths and provider-authored Markdown body |
| Appearance and color editors | Mapper on field labels, picker controls, status notes, and reset actions | CSS values, color values, font names, and user-entered names |
| Bulk action toolbar | Mapper on selection and action chrome | Selected record descriptions and action results supplied by callers |
| File converter | Mapper on wizard chrome, queue controls, and app-owned warnings | Paths, detected bytes, adapter ids, and converter diagnostics |
| Local model manager | Typed copy segments around tabs, health states, controls, and app-owned guidance | Model references, provider metadata, endpoint values, versions, hardware facts, fit evidence, queue phases, and streamed chat content |
| Explorer and project switcher | Mapper on navigation, status, and control chrome | Project names, paths, SSH endpoints, branch names, and session facts |

The converter catalogue also gives every category its own search state and anchored builder. Adapter
format labels and ids remain exact technical names, while category copy, counts, badges, and empty
states use the mapper. Availability reasons and detection notes are typed diagnostic facts, so they
remain exact beside their mapped labels. Confidence values, byte counts, model-fit evidence, endpoint
values, and diagnostics are facts and remain unchanged.

Documentation metadata is split the same way: generated section labels are application navigation
copy, while article paths, article titles, Markdown bodies, search snippets, and external links are
authored-document facts. Local history and changelog surfaces map their filter and action chrome, but
keep revision ids, timestamps, release versions, commit links, recorded labels, and diagnostic text
exact. This keeps search and history traceable even when a vocabulary replacement is active.

## Ownership rule

Only text authored by this application is mapped. External or user-owned data remains byte-identical,
including release notes, documentation article bodies, model names, filesystem paths, project names,
session transcripts, detected adapter messages, revision ids, and network diagnostics. A template may
be mapped only when its surrounding facts are app-authored and the dynamic values remain factual.

## Field-level evidence

Mixed sentences use the typed segment helper in `src/renderer/lib/personalVocabulary/ownedCopy.ts`:

| Segment kind | Mapper behavior | Examples |
| --- | --- | --- |
| `copy` | Passes through the active local mapper | Labels, actions, status prose, accessibility descriptions |
| `fact` | Concatenates byte-for-byte without mapping | Paths, model names, colours, patterns, revisions, counts, diagnostics |

`ConfirmDialog.messageSegments` and the bulk preview use the same contract for confirmation sentences.
The focused `ownedCopy.test.ts` test proves the primitive boundary, while
`productionConsumers.test.ts` exercises the production formatting consumers for bulk previews,
appearance imports, converter detection, adapter search, model catalogue and staleness, project
switching, documentation counts, history restore, and changelog outcomes. These are source and
component-consumer evidence, not a claim of packaged or runtime verification.

The School mode policy still suppresses the mapper until its shared record has been read successfully.
No file loaded means the shipped wording is returned unchanged. A rejected, malformed, stale, or
cleared file never applies partially.

## Verification boundary

`scripts/personal-vocabulary-producer-manifest.mjs` carries the canonical hand-written rows for
every live Canvas node registration, lazy panel, root host, detached entrypoint, bridge, site
entrypoint, and native-notification boundary. `scripts/check-personal-vocabulary-coverage.mjs`
cross-checks live discovery against that fixed list and checks reachability, mapper/segment
consumption, factual bindings, School-mode/cache policy, privacy, documentation, and focused tests.
The field-level copy/fact contract is exercised behaviorally
by `ownedCopy.test.ts`, rather than by brittle source substring needles. The rows are intentionally
separate from the discovered source list so removing one surface cannot make the inventory shrink
with the implementation. Rows marked open are intentionally reported as incomplete until their
own implementation repair lands.
Runtime rendering, narrow-layout behavior, and the packaged artifact remain separate evidence and are
not claimed by this source-level record.

## Suggested articles

- [Personal vocabulary JSON contract](../../personal-vocabulary.md)
- [Material Design 3 audit](./material-3-audit.md)
- [In-app documentation browser](../help/in-app-documentation.md)
