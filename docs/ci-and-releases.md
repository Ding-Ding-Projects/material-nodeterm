# CI and releases

This document describes `.github/workflows/release.yml` (the build + release pipeline) and
`.github/workflows/ci.yml` (a non-gating PR build check): what each one does, what it
deliberately does **not** do, and the honest cost of that trade-off.

## The governing policy

**GitHub Actions runs no tests, type-check or lint. Nothing in a workflow gates the release.**

`release.yml` builds the app, packages a Windows installer, and publishes it as a GitHub
Release — that is the whole job. A run fails only when the build, the packaging, or the
publication itself fails. It does not run `npm test`, it does not run `npm run typecheck`,
and it does not run a linter. This is a standing decision, not an oversight:

- **What this costs.** With no gate in the pipeline, a release can ship from a commit whose
  tests would have failed. The first thing that notices is a person running the installer,
  not a red CI check. That is the accepted trade-off in exchange for artifacts reaching
  people quickly and unconditionally, on every branch update push.
- **Where checking actually happens.** The repository's own test scripts
  (`npm test`, `npm run typecheck`) still exist and are still meant to be run — just locally,
  by whoever is changing the code, before they push. See `CONTRIBUTING.md`. A failing local
  test is still a real defect to fix in the same change; it is simply never a required check
  wired into a workflow, and its result is never implied by a release existing.
- **`ci.yml` is not an exception to this.** It builds the app on a pull request (electron-vite
  compile only — no tests, no type-check, no lint) purely as fast, disposable feedback. It has
  no `needs:` relationship to `release.yml`, is not a required status check, and cancels a
  superseded run outright (`concurrency: cancel-in-progress: true`) — safe only because it
  never publishes anything. `release.yml` instead uses a non-cancelling group keyed by its
  workflow name and run number. Attempts of one run cannot overlap, while different pushes do
  not share a group and may build concurrently. A repository-wide release group is deliberately
  rejected: GitHub keeps only one pending member of a concurrency group and cancels an older
  pending member when a new one arrives, which would silently skip pushes.

## What `release.yml` actually does

Triggered by every **branch** `push` (`branches: ['**']`, so tag pushes cannot match) and by
`workflow_dispatch`, on `windows-latest` — Windows is the active delivery target for this
project. Branch-deletion events are ignored because they contain no commit to package. One job:

1. **Checkout** with full history (`fetch-depth: 0`) — needed for the line-count report's
   `git blame` attribution and for an honest commit link in the release notes.
2. **Record the workflow start time** via `gh api repos/.../actions/runs/<run id>` (GitHub's
   own `run_started_at`). If this call fails (missing `actions: read` on a fallback token,
   API hiccup) the step warns and leaves it unset — `release-notes.mjs` then reports the
   start time as **missing**, never an estimate.
3. **Install dependencies** — `npm ci`, which also runs the project's own `postinstall` hook
   (`scripts/patch-node-pty.mjs` + `electron-rebuild -f -w node-pty,smart-whisper` against
   this runner's Electron ABI). `windows-latest` already ships the Visual Studio Build Tools
   and Python that native module compilation needs; nothing extra is bootstrapped for that.
   If a future dependency needs a tool the runner image does not carry, add a check-then-
   install step here, immediately before it is needed.
4. **Build** — `npm run make-icon` then `npm run build` (electron-vite: main + preload +
   renderer).
5. **Compute a monotonic release tag** — `v<package.json version>-ci.<run number>`. GitHub
   guarantees a workflow's own run number only ever increases and never repeats, so no two
   runs can collide on a tag and no prior release is ever recycled or overwritten.
6. **Package only the Windows Squirrel target** —
   `electron-builder --win squirrel --x64 --publish never`, producing `Setup.exe`, `RELEASES`,
   the full `.nupkg` (and a delta `.nupkg` when present) under `dist/squirrel-windows/`.
7. **Validate a real, complete Squirrel set** with `scripts/release-assets.mjs`: exactly one
   setup executable, exactly one `RELEASES`, at least one full `.nupkg`, no empty assets, and
   every package entry in `RELEASES` matching the file's SHA-1 and byte size. "The directory
   contained something" is deliberately not enough.
8. **Verify the setup is genuinely unsigned** — Authenticode must report exactly `NotSigned`.
   An invalid, untrusted, or otherwise anomalous signature is not accepted as a synonym for
   unsigned (see [Signing](#signing) below).
9. **Stage one draft release** for the run's tag. A retry reuses its existing draft; a retry of
   an already-successful run verifies the release tag still resolves to this run's exact commit,
   then validates every public asset name and byte size before exiting without touching them.
   This avoids `gh release upload --clobber`'s delete-before-replace behaviour ever operating on
   a public asset.
10. **Upload only to the draft.** Unexpected leftovers from an older failed attempt are pruned,
    and expected names are replaced with `--clobber`. Any failure leaves a private draft, never
    a public empty or partial release.
11. **Generate the final release notes after upload** (`scripts/release-notes.mjs`, embedding
    `scripts/count-lines.mjs`'s report — see [Release notes content](#release-notes-content)).
12. **Read the draft back from GitHub and compare every expected name and byte size.** Only after
    that exact remote inventory passes does one `gh release edit --draft=false` publish it. A
    second read verifies the public transition retained the same complete inventory.
13. **Collect and upload build artifacts**, `if: always()`, `continue-on-error: true` on both
    the collection and the upload — so a failed run still leaves the packaged output, the
    generated notes, and the run context inspectable, without ever masking or reversing the
    real pass/fail verdict of the steps above it. Only explicitly safe paths are copied: the
    packaged installer output and the generated notes file — never `node_modules`, caches, or
    the source tree.

### Publication transaction and retries

The public boundary is intentionally one-way: build → validate locally → create or reuse a
**draft** → upload → validate remotely → publish. There is no command earlier in the job that can
create a non-draft release. An upload failure can leave a draft for inspection, but it cannot
expose an assetless release to downloaders.

`GITHUB_RUN_NUMBER` stays fixed across attempts, so a rerun owns the same tag. The per-run
concurrency key and `cancel-in-progress: false` prevent two attempts from mutating that draft at
once. A completed rerun is also safe: it checks the tag's exact commit plus the public names and
sizes, then reuses the release instead of applying `--clobber`, whose replacement sequence could
otherwise remove a good public asset and then fail before uploading its replacement. Different
run numbers own different tags and drafts, so concurrent pushes cannot collide.

GitHub evaluates the workflow file from the pushed ref, not retroactively from `main`. Therefore
this contract governs a branch only after that branch contains the corrected workflow. A
read-only 2026-08-15 audit found 113 of 121 remote branches still carried a pre-change copy;
updating or removing those refs is repository administration outside this code change, and no
branch was modified here.

The workflow contract is checked locally, never in Actions:

```bash
node scripts/check-release-workflow.mjs
npx vitest run src/main/release-workflow-contract.test.ts \
  src/main/release-assets-script.test.ts
```

The checker parses the YAML, follows invoked npm scripts, and verifies command ordering and draft
state. Its gates deliberately mutate the trigger, tag guard, concurrency, package target, signing
status, draft creation, upload retry, remote verification, and hidden package-script validation;
source-text presence alone is not accepted as evidence.

### Token resolution

Only steps that call GitHub's API receive `GH_TOKEN`; dependency installation, repository
scripts, compilation, and electron-builder do not. Checkout also uses
`persist-credentials: false`, so it does not leave the contents-write token in git config.
The timing read uses the short-lived `${{ github.token }}`. Release mutation steps prefer a
step-scoped `${{ secrets.RELEASE_TOKEN || secrets.ORG_TOKEN || github.token }}` because creating
a release tag targeting a commit that changes `.github/workflows` may require workflow-write in
addition to contents-write. A classic token therefore needs `repo` + `workflow`; a fine-grained
token or GitHub App needs Contents: write and Workflows: write. No suitable custom secret is
currently visible at repository scope, so publishing this workflow-changing commit on the live
fork remains unverified. These tokens are never passed to `npm ci` or build subprocesses, but
branch write access and workflow changes remain a trust boundary rather than a sandbox.

## Signing

**Code signing is permanently out of scope for this project.** The workflow never requests,
purchases, generates, renews, stores, or uses a code-signing certificate, private key,
timestamp credential, signing secret, or signer service — it never sets `CSC_LINK` or
`CSC_KEY_PASSWORD`, so electron-builder has no certificate to sign with in the first place.
The packaging step additionally sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so electron-builder
cannot opportunistically pick one up from the runner's own certificate store.
`build.win.signExecutable: false` is the explicit no-sign control; resource editing remains on so
the executable still receives its icon, name/version metadata, and execution level. Root
`build.forceCodeSigning: false` permits the intended unsigned output. A
dedicated verification step reads the built installer's actual Authenticode signature and
requires `NotSigned`; `Valid`, `HashMismatch`, `NotTrusted`, `UnknownError`, and every other
status fail the run. Signing prohibition is enforced, not just documented.

Every release's notes carry an explicit warning: **the installer is unsigned**, and running it
will trigger Windows SmartScreen and the unknown-publisher warning. That is expected, not a
sign of tampering; verify a download by checking the release's commit link and asset list
instead of by a signature that does not exist.

## Release notes content

`scripts/release-notes.mjs` builds the full body of every published release. It never implies
a check ran that did not, and it never estimates a missing timestamp — a missing value is
printed as **missing**, not guessed at. It always includes:

1. **Release-preparation timing** — `Workflow started` (from GitHub's own `run_started_at`,
   or "missing" if that read failed), `Release notes generated` (stamped after asset upload),
   and `Elapsed to release notes` as a stable `HH:mm:ss`. It deliberately does not call this
   workflow completion: remote verification, publication, and the public post-check follow.
2. **The project's line count at that exact commit**, via `scripts/count-lines.mjs` —
   see below.
3. **What actually ran** — an explicit statement that no tests, type-check, or lint ran in
   this workflow, alongside the real list of steps that did (`npm ci`, `npm run make-icon`,
   `npm run build`, `electron-builder --win squirrel --x64 --publish never`). This section exists
   specifically so a release is never read as "passing" a check it never ran.
4. **The unsigned-installer warning** described above.
5. **The asset list** (installer filename + size), when the packaging step located any.

### `scripts/count-lines.mjs`

The repository's committed line counter (`node scripts/count-lines.mjs [ref]`, defaulting to
`HEAD`). It is a plain, pure `computeLineCounts()` function plus a small CLI wrapper —
`release-notes.mjs` imports the function directly rather than shelling out, so a standalone
run of the counter and what a release actually reports can never drift apart.

- **Categories, counted separately, total and non-blank:** `source`, `tests` (anything
  matching `*.test.*`, `*.spec.*`, or under a `test(s)/`/`__tests__/` directory), `styles`
  (`.css`/`.scss`/`.less`), `docs` (`.md`), `config` (`.json`/`.yml`/`.yaml`).
- **Per-language split** — one row per recognized extension across the whole tree.
- **Exclusion list, stated explicitly** rather than silently dropped: the npm-generated
  `package-lock.json`, vendored license text under `resources/licenses/`, binary art assets
  under `resources/mascot/` and `docs/assets/`, and prebuilt vendored binaries under
  `resources/bin/`. Any tracked file with an extension the counter does not recognize (images,
  fonts, `.plist`, `Dockerfile`, dotfiles, `.jsonl` fixtures, …) is listed separately as
  uncounted rather than silently folded into either total.
- **Project total vs. grand total.** This repository has no tracked vendored source subtree,
  so the two are currently identical and the report says so plainly. The distinction is kept
  in the output shape anyway, so a future vendored subtree cannot silently merge into the
  project figure without the report's own structure forcing someone to notice.
- **Attribution — agent-written vs. person-written, by *surviving* lines.** This is
  deliberately **not** a sum of added lines from `git log`: a line written and later deleted
  belongs to nobody, and churn is not authorship. Instead, every counted file is blamed
  (`git blame --line-porcelain`) at the report's ref, and each surviving line is attributed to
  the commit that introduced it. A commit counts as agent-written when its author name/email
  matches a known automation identity, or its commit message carries a `Co-Authored-By:`
  trailer naming one (case-insensitive match against `claude`, `codex`, `copilot`, `openai`,
  `bot`, `[bot]`, `github-actions`, or `noreply@anthropic.com`). Every other attributable line
  is a person's. The exact rule string is included in every report, so it can be checked
  rather than taken on faith.
- **Ref validation fails loudly.** A ref that does not resolve to a commit raises an error
  instead of silently reporting every count as zero — an empty table and "there is nothing
  here" must never be indistinguishable outcomes.

Both `npm run make-icon` outputs and everything under `resources/` that is genuinely this
project's own hand-written source (none currently, beyond the license/art exclusions above)
stay in scope for the count; only the paths named above are excluded.

## The tag-trigger loop (2026-08-15) and how it was actually stopped

`release.yml` used to trigger on a bare `push:` — no branch filter — and every successful run
**publishes a tag**. A bare `push:` trigger fires on a tag push exactly the same as a branch
push, so the workflow was, unintentionally, its own trigger: a run published `v0.3.0-ci.2`, the
push of that tag started another run, which published `v0.3.0-ci.3`, and so on with no upper
bound. By the time anyone noticed and manually disabled the workflow in GitHub Actions,
`gh release list` showed **43** tagged releases and `gh run list --workflow=release.yml` showed
**85** runs of it — every one of them `failure` or `cancelled`, none reaching the packaging step
cleanly — spanning about an hour. None of the 43 releases carried an installer: the build was
failing the whole time on an unrelated broken stylesheet (since fixed), so every run died before
the packaging step that would have attached one, but the release-creation step in whichever
workflow version that run happened to be executing had already run by then.

**Why a `main`-branch fix alone could not stop it.** A GitHub Actions workflow run checks out and
executes the copy of the workflow file that lives at the ref that triggered it. A run triggered
by tag `v0.3.0-ci.7` runs `v0.3.0-ci.7`'s `.github/workflows/release.yml`, not whatever is
current on `main` — so pushing a fix to `main` could not reach, or stop, runs that were already
being triggered by tags created before the fix existed. Only two things actually stopped the
loop:

1. **The trigger fix**, `on.push.branches: ['**']` (see the comment on that block) — this stops
   any *new* tag from starting a *new* run, but only for runs that check out a workflow file
   which already contains this filter.
2. **Manually disabling the workflow** in GitHub Actions (`gh workflow disable release.yml` or
   the Actions UI) — this is what actually stopped runs that were still being triggered by
   already-published tags checking out their own, unfixed, copy of the file. The branch filter
   is necessary but was not, by itself, sufficient to end an already-running loop.

**The workflow was manually disabled to stop that incident and has since been re-enabled.**
A read-only `gh workflow list --all` check on 2026-08-15 reports `Release` as `active`; this
change does not enable, disable, trigger, or otherwise mutate the live workflow.

### The fail-fast tag guard

The branch filter closes the trigger for new pushes, but it lives in the same file it is meant
to protect: a future edit could loosen the trigger while accidentally leaving the job runnable,
or a `workflow_dispatch` could target a tag ref. So the release job's very first step is a
redundant check: `if: github.ref_type == 'tag'` fails before checkout or dependency install. It
protects only refs whose own workflow copy contains the guard. A genuinely old/reverted copy
without it is not retroactively protected; disabling the workflow or updating/removing the unsafe
ref remains the remedy. On a normal branch run the condition is false and the step is skipped.

### The honest cost of an ungated pipeline, restated

The "governing policy" section above already names the trade-off this project has chosen: no
test, type-check, or lint gate on the release pipeline, so a broken commit can reach a published
release before a human notices. The tag-trigger loop is what that trade-off looks like when it
goes wrong in the *other* direction the policy did not originally anticipate: not "one bad build
shipped once," but a runaway trigger turning one broken build into dozens of empty releases in
under an hour, entirely unattended, because nothing in the pipeline's own design could tell it to
stop. An ungated pipeline is not just a pipeline that might publish something broken — it is a
pipeline that, absent an explicit guard, has no internal reason to publish exactly one thing per
change instead of an unbounded number. The fail-fast tag guard above is that explicit reason,
made cheap and redundant on purpose: it does not reintroduce a quality gate (nothing here runs a
test or a linter), it only guarantees the release job cannot be *entered* by the one trigger shape
that is known to make it self-perpetuating.

## What is deliberately out of scope for this lane

- **`security.yml`** (CodeQL + dependency review) is untouched. It runs on `pull_request`/
  `push` to `main` and a weekly schedule, independently of `release.yml` — there is no
  `needs:` relationship between them, and it does not gate the release pipeline. Whether
  CodeQL/dependency-review themselves count as "release-gating checks" this policy targets is
  a call for whoever owns that workflow to make explicitly; this document does not extend the
  no-tests/no-lint policy to it by inference.
- **macOS and Linux packaging** (the project's previous signed/notarized macOS release and
  unsigned Linux release, including the Homebrew tap sync) have been removed from
  `release.yml`. The active delivery scope for this project is Windows only. Historical
  macOS/Linux release history remains on GitHub as a record; reopening cross-platform delivery
  is a deliberate, explicit decision for later, not an oversight here.
- **Windows app icon URL.** No `build.squirrelWindows.iconUrl` is configured. Electron-builder
  derives a repository URL for the generated build-resource icon, but that file is ignored and
  the derived URL may not resolve. This only affects the icon Squirrel shows in Windows'
  "Apps & features" list (cosmetic; it does not fail packaging or the release). A real,
  committed, multi-resolution `.ico` remains branding follow-up work.
