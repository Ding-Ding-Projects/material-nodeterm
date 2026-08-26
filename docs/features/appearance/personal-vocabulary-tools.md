# Personal vocabulary coverage for tools and documentation

The local personal-vocabulary file is applied at the final renderer boundary for application-authored
copy in the tool and documentation surfaces listed below. The file is never sent across the bridge,
stored in a project file, included in an export, or applied to user data, provider-authored content,
paths, identifiers, commands, or machine output.

## Covered surfaces

| Surface | Boundary | Content intentionally left exact |
| --- | --- | --- |
| Regex builder and anchored trigger | `useVocabularyMapper()` around labels, hints, statuses, and accessible names | Pattern text, flags, engine identifiers, sample text, and generated match data |
| Context menu and command palette | `useVocabularyMenuItems()` and `useVocabularyCommands()` | Actions, shortcuts, identifiers, values, colors, and command bodies |
| Changelog and release cards | Mapper on app-owned chrome and action labels | Release versions, dates, commit SHAs, commit URLs, and release bullet Markdown |
| Local history | Mapper on filters, statuses, action chips, and controls | Revision SHAs, timestamps, filenames, and recorded mutation facts |
| Offline documentation | Mapper on browser chrome and link titles | Bundled article paths and provider-authored Markdown body |
| Appearance and color editors | Mapper on field labels, picker controls, status notes, and reset actions | CSS values, color values, font names, and user-entered names |
| Bulk action toolbar | Mapper on selection and action chrome | Selected record descriptions and action results supplied by callers |
| File converter | Mapper on wizard chrome, queue controls, and app-owned warnings | Paths, detected bytes, adapter ids, and converter diagnostics |
| Local model manager | Mapper on tabs, health states, controls, and app-owned guidance | Model references, provider metadata, hardware facts, and streamed chat content |
| Explorer and project switcher | Mapper on navigation, status, and control chrome | Project names, paths, SSH endpoints, branch names, and session facts |

## Ownership rule

Only text authored by this application is mapped. External or user-owned data remains byte-identical,
including release notes, documentation article bodies, model names, filesystem paths, project names,
session transcripts, detected adapter messages, revision ids, and network diagnostics. A template may
be mapped only when its surrounding facts are app-authored and the dynamic values remain factual.

The School mode policy still suppresses the mapper until its shared record has been read successfully.
No file loaded means the shipped wording is returned unchanged. A rejected, malformed, stale, or
cleared file never applies partially.

## Verification boundary

`scripts/check-personal-vocabulary-coverage.mjs` carries hand-written rows for these surfaces and
checks the exact mapper call on each production file. The rows are intentionally separate from the
discovered source list so removing one surface cannot make the inventory shrink with the implementation.
Runtime rendering, narrow-layout behavior, and the packaged artifact remain separate evidence and are
not claimed by this source-level record.

## Suggested articles

- [Personal vocabulary JSON contract](../../personal-vocabulary.md)
- [Material Design 3 audit](./material-3-audit.md)
- [In-app documentation browser](../help/in-app-documentation.md)
