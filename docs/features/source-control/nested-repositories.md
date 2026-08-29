# Nested repository discovery

**Category:** [Source control](./README.md)

## Behaviour

One nodeterm project can now own a folder that contains several independent Git repositories, such
as `frontend/` and `backend/`. Source Control discovers those repositories and presents them beside
the project's main checkout and any bound worktree scopes. The repository picker shows each name and
its path relative to the project folder. Choosing a row makes that checkout the active target for
status, history, diffs, staging, commit, branch, fetch, and remote actions.

The picker is a real searchable control. Plain-text filtering is the default, and the adjacent `.*`
affordance opens the full anchored regex builder for deliberate regex searches. Keyboard arrows move
through the filtered rows, Enter selects one, and Escape clears the query before closing. A screen
reader receives the result count and the selected repository's relative path.

## Configuration and bounds

Discovery runs when Source Control opens and when its project changes. It visits at most four levels
below the project folder and 512 directories. Known dependency, generated-output, cache, VCS,
coverage, and virtual-environment directories are ignored. Simple directory-name entries in local
`.gitignore` files are also respected. Symlinked directories and symlinked `.git` markers are never
followed. Every candidate is verified with `git rev-parse --show-toplevel`, so a directory inside a
parent repository is not mistaken for a second repository.

The scan reports its completeness, number of visited folders, ignored folders, skipped links, and
whether a bound was reached. A partial or failed scan is not treated as an empty result. SSH projects
keep their existing remote Source Control route, but nested discovery is unavailable until a host
side filesystem scanner can provide the same bounded and explicit contract.

## Portability

The portable identity of a discovered repository is its forward-slash project-relative path, for
example `frontend`. The absolute path used to execute Git is machine-local runtime data. It is not
stored in project JSON, exports, synchronization payloads, logs, history, or generated metadata.
When the project opens on another computer, the relative path is resolved under that computer's
chosen project folder. If it is absent, the picker reports the missing repository and leaves the
project's main folder unchanged.

## Failure modes

- A missing or unreadable project folder produces an explicit discovery error.
- A permission error in a nested folder marks the result incomplete and preserves repositories found
  elsewhere.
- A depth or directory limit produces a bounded partial result with an explanation.
- A symlink is skipped rather than followed into an unrelated directory.
- A nested `.git` marker that does not resolve to its containing folder is not offered as a scope.
- An unavailable SSH scan is reported as unsupported, never as “no nested repositories”.

## Security considerations

The scanner is local-only and does not fetch, clone, modify, or execute repository content. It runs
only fixed `git rev-parse` probes against directories selected by the bounded traversal. It does not
follow symlinks, so a repository cannot redirect discovery outside the project folder. The scope
picker passes the verified runtime checkout path to the existing typed Git API; it does not construct
shell commands from display labels or relative metadata.

## Verification

Use a temporary project folder containing two independent repositories, one ordinary nested folder,
one ignored output folder, and one symlink. Confirm the picker lists only the two repositories, the
relative paths remain stable, and selecting either one changes the live branch and file list. Repeat
with a project whose root is itself a repository, a non-repository root, an unreadable child, and a
tree deeper than the configured bound. Check the picker in plain-text and regex modes, including
keyboard navigation and the no-match state.

## Suggested articles

- [Source control and worktrees](./source-control-and-worktrees.md)
- [Projects and tabs](../projects/projects-and-tabs.md)
- [Regex builder](../global-and-project-settings.md)
