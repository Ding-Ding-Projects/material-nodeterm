# Build version and updated time

The empty-project start screen identifies the exact application version and the time that version
was built. The time is rendered in local time with seconds and a timezone abbreviation, so a user
can distinguish two builds made close together and report the build they are actually running.

## Behavior

The renderer receives a build stamp from `electron.vite.config.ts`. The stamp contains the package
version, the ISO 8601 build time, and the source commit when one is available. The start screen
uses the stamped version before the optional runtime version bridge responds. This keeps the line
visible when the runtime bridge is unavailable and avoids showing Electron's own version during an
unpackaged run.

The displayed line has the form `v<version> · Updated <local date and time>`, with seconds and a
timezone. In English, Cantonese, and bilingual modes, the surrounding label is localized while
the version, date, time, seconds, and timezone remain factual. A missing or invalid stamp produces
an explicit unavailable message and never substitutes launch time, a file timestamp, or a manually
entered value.

## Configuration and provenance

Build provenance is generated as part of the renderer build. The package version is read from
`package.json`, and the commit is read from the checked-out source when Git metadata is present.
The commit is informative, while the version and build time are the values shown to the user.
The feature does not create or persist a second runtime metadata store.

## Failure and security behavior

The stamp is treated as untrusted input and parsed through `readBuildProvenance`. Missing values,
empty values, and invalid dates remain visible as an unavailable state. The optional runtime
version call cannot hide a valid stamped value. No credentials, paths, or network responses are
included in the displayed line.

## Verification

The implementation is covered by the existing shared provenance formatter and renderer wiring.
This feature lane was limited to static inspection and `git diff --check`; runtime interaction,
builds, packaging, tests, and screen captures were not run in the ultra-speed delivery pass.

Suggested articles: [Material Design 3 migration status](./material-3-migration-status.md),
[Language modes](../README.md), and [CI and releases](../../ci-and-releases.md).
