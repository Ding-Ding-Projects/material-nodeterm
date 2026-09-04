# Windows-only source contract

`scripts/check-windows-only.mjs` is the source-level check for the Windows-only desktop conversion. It scans a fixed, hand-written inventory rather than discovering folders from the current checkout. This keeps a renamed file inside the contract and makes a removed project root fail loudly.

## Covered inventory

The scanner checks text files below `src/`, `scripts/`, `test/`, `docs/`, `site/`, and `.github/`, plus the selected root build, packaging, configuration, changelog, handoff, roadmap, and README files listed in its inventory. The file extensions are listed beside each inventory root in the scanner source so adding a new text format requires an intentional change.

The check rejects desktop operating-system support names, legacy platform identifiers, platform-specific application packaging names and keyboard command-modifier symbols. It examines comments and documentation as well as executable code because stale support language can keep an old delivery path alive or mislead the next maintainer.

## Explicit exclusions

Two exclusions are narrow and recorded in the scanner:

1. `package-lock.json` is generated dependency metadata, so it is not treated as authored support logic.
2. Binary evidence formats such as PNG, JPEG, WebP, ICO, ZIP, and package archives are not decoded by this text scanner. SVG remains included because it is source text. Platform-specific package containers are rejected by filename before byte decoding. A binary exclusion does not apply to a source, test, configuration, documentation, HTML, site, or script file with a text extension.

The scanner scans its own source. Its forbidden-term catalog is assembled from neutral fragments, so no self-exemption can hide an accidental literal support marker.

## Failure behavior

Every finding is sorted and printed as `path:line:column`, followed by its category and rule identifier. This gives a maintainer a direct edit location without relying on scan order. Missing inventory roots, unreadable directories, unreadable files, non-file inventory entries, and symbolic links are errors. They are never silently skipped.

The scanner does not remove or rewrite support code. A failed run is an actionable report that leaves the source decision with the maintainer.

## Focused fixture check

Run:

```text
node scripts/check-windows-only.test.mjs
```

The fixture check creates a complete temporary inventory, proves a clean tree is green, then proves that one legacy platform branch is red with an exact location. It also verifies that a renamed source file, a commented-out forbidden line, package evidence, keyboard modifier symbols, and an unreadable inventoried file cannot evade the check. Generated lock data and binary evidence are exercised as explicit exclusions.

This is a source contract only. It does not claim that the entire conversion is complete, and it does not replace built-application verification.
