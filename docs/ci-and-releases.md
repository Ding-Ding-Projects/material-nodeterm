# CI and releases

This document describes `.github/workflows/release.yml` (the build + release pipeline) and
`.github/workflows/ci.yml` (a non-gating PR build check): what each one does, what it
deliberately does **not** do, and the honest cost of that trade-off.

## The governing policy

**GitHub Actions runs no tests, type-check or lint. Nothing in a workflow gates the release.**

## v1.0.0 source candidate

The source candidate currently sets `package.json` and `package-lock.json` to `1.0.0`. This is a
deliberate human-selected major release, not an automatic patch decision. The workflow's normal
planner remains responsible for ordinary patch releases, while a maintainer may intentionally
select a minor or major version by committing it before publication. The candidate is not a
published release until a workflow run creates and verifies the unique non-draft tag, installer,
release assets, timing, line-count report, and dim-sum photo link.

The candidate preparation records local check results separately from release publication. In
particular, a passing release-version test or workflow checker proves the planner contract only;
it does not prove a built installer, an installed runtime, or the production upgrade receipt.
The remaining runtime receipt follows [`windows-support.md`](windows-support.md) and must use the
isolated Windows route against the published `v0.4.152` baseline and the `1.0.0` Setup candidate.

On every push to `main`, and on a manual `workflow_dispatch` from `main`, `release.yml` builds the
app, packages a Windows installer, and publishes it as a GitHub Release — that is the whole job. A
run fails only when its ref guard, build, packaging, validation, or publication fails. It does not
run `npm test`, it does not run `npm run typecheck`, and it does not run a linter. This is a
standing decision, not an oversight:

- **What this costs.** With no gate in the pipeline, a release can ship from a commit whose
  tests would have failed. The first thing that notices is a person running the installer,
  not a red CI check. That is the accepted trade-off in exchange for artifacts reaching
  people quickly whenever `main` advances. Manual dispatch remains available for an explicit
  rerun from `main`.
- **Where checking actually happens.** The repository's own test scripts
  (`npm test`, `npm run typecheck`) still exist and are still meant to be run — just locally,
  by whoever is changing the code, before they push. See `CONTRIBUTING.md`. A failing local
  test is still a real defect to fix in the same change; it is simply never a required check
  wired into a workflow, and its result is never implied by a release existing.
- **`ci.yml` is not an exception to this.** It builds the app on a pull request (electron-vite
  compile only — no tests, no type-check, no lint) purely as fast, disposable feedback. It has
  no `needs:` relationship to `release.yml`, is not a required status check, and cancels a
  superseded run outright (`concurrency: cancel-in-progress: true`) — safe only because it never
  publishes anything. `release.yml` instead uses a non-cancelling group keyed by workflow and ref,
  so attempts for the same `main` ref cannot cancel one another between draft creation and
  publication. Push-triggered runs and manual reruns use the same non-cancelling protection.

## What `release.yml` actually does

Triggered by a push to the `main` branch or by `workflow_dispatch`, on `windows-latest` — Windows
is the active delivery target for this project. The branch-filtered push trigger excludes tags and
feature branches, while the workflow's first step independently refuses anything except a branch
ref exactly equal to `refs/heads/main` before checkout. Every accepted push to `main` therefore
publishes automatically; manual dispatch remains available from `main` for an explicit rerun. One
job:

1. **Refuse non-`main` refs** before checkout, dependency installation, or token-bearing release
   steps. The push trigger is already filtered to `main`; this independent check exists because a
   manual dispatch can otherwise select another ref.
2. **Checkout** with full history (`fetch-depth: 0`) — needed for the line-count report's
   `git blame` attribution and for an honest commit link in the release notes.
3. **Verify the checked-out commit** equals the dispatch event's exact `GITHUB_SHA`; packaging a
   different checkout under the intended commit's release would be a false provenance claim.
4. **Record the workflow start time** via `gh api repos/.../actions/runs/<run id>` (GitHub's
   own `run_started_at`). If this call fails (missing `actions: read` on a fallback token,
   API hiccup) the step warns and leaves it unset — `release-notes.mjs` then reports the
   start time as **missing**, never an estimate.
5. **Set up Node 24.19.0** with the npm cache, matching `package.json`'s exact
   `devEngines.runtime.version`, then compute the stable release tag - exactly
   `v<package.json version>`. The version must be a stable `major.minor.patch` value; a run-number
   or prerelease suffix is refused because the Windows updater's `latest/download` feed must never
   point at a feature build masquerading as stable.
6. **Bootstrap the selected Windows native toolchain** before `npm ci`. The workflow uses the
   repository's validated Visual Studio selector/installer in its narrowly scoped
   `--elevated-toolchain-only` mode, initializes its `VsDevCmd` environment, confirms x64 Spectre
   libraries, and exports only the needed developer variables to later steps. It does not disable
   Spectre mitigation or rely on whichever Visual Studio installation happens to be first on the
   runner.
7. **Verify stable version advancement before the build.** The release helper reads every hosted
   tag and release, rejects a non-newer version or a tag already owned by another commit, and binds
   this candidate to the exact source SHA. `0.4.0` is the candidate after `0.3.0`.
8. **Install dependencies** — `npm ci`, which also runs the project's own `postinstall` hook
   (`scripts/patch-node-pty.mjs` + `scripts/rebuild-electron-native.mjs` against this runner's
   Electron ABI). The wrapper uses `@electron/rebuild --only` for exactly `node-pty` and
   `smart-whisper`, pins sequential module processing, and disables MSBuild node reuse. It permits
   three total attempts with bounded backoff only for measured MSBuild runtime/JIT signatures, then
   loads both packages under Electron before reporting success. `windows-latest` already ships the Visual Studio Build Tools
   and Python that native module compilation needs; nothing extra is bootstrapped for that.
   If a future dependency needs a tool the runner image does not carry, add a check-then-
   install step here, immediately before it is needed.
   The later application-build phase retries once only if its fresh process exits with exact status
   `0xC0000409`; it removes partial `out/` first and retains the same already-verified published icon
   metadata. Every other application-build exit remains fatal.
9. **Build and package through `npm run dist:win`.** The Windows-only wrapper runs the native
   preflight, regenerates and proves the committed seven-frame ICO at an immutable source-SHA URL,
   clears stale generated output, builds the app and session host through `build:app` (the release
   route does not run repository quality checks), invokes only the x64 Squirrel target with
   publishing disabled, then verifies the nuspec and Setup/app/stub PE resources.
10. **Validate a real, complete Squirrel set** with `scripts/release-assets.mjs`: exactly three
   assets, the exact version/product Setup, one `node-terminal` full package, and one `RELEASES`
   index. Delta packages and unrelated output are refused. The validator also proves semantic
   ID/version/title metadata and bidirectional RELEASES SHA-1/name/size agreement. It emits the
   exact name/size/SHA-256 manifest later checked against GitHub's hosted digests. The workflow
   also reruns the packaged icon/nuspec proof.
11. **Verify the setup is genuinely unsigned** — Authenticode must report exactly `NotSigned`.
   An invalid, untrusted, or otherwise anomalous signature is not accepted as a synonym for
   unsigned (see [Signing](#signing) below).
12. **Stage one draft release** for the stable tag. A retry reuses its existing draft; a retry of
   an already-successful run verifies the release tag still resolves to this run's exact commit,
   then validates every public asset name and byte size before exiting without touching them.
   This avoids `gh release upload --clobber`'s delete-before-replace behaviour ever operating on
   a public asset.
13. **Upload only to the draft.** Unexpected leftovers from an older failed attempt are pruned,
    and expected names are replaced with `--clobber`. Any failure leaves a private draft, never
    a public empty or partial release.
14. **Generate the publication-ready release notes after upload** (`scripts/release-notes.mjs`, embedding
    `scripts/count-lines.mjs`'s report — see [Release notes content](#release-notes-content)).
15. **Read the draft back and recheck version authority immediately before publication.** The
    exact hosted asset inventory, draft/non-prerelease state, target/tag ownership, and stable
    version ordering must all still hold; this catches a newer stable release created while the
    build ran.
16. **Publish once, explicitly as latest and non-prerelease**, then re-read the tag, release, and
    latest-release view to prove the complete inventory and exact target survived the transition.
17. **Record the post-publication completion boundary and finalize the notes.** Regenerate notes
    with exact `Workflow started`, `Workflow completed`, and `Workflow duration` values, edit the
    same published release, then read it back and require exact body equality. A retry of an
    already-published release verifies those fields and changes nothing.
18. **Collect and upload build artifacts**, `if: always()`, `continue-on-error: true` on both
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

The stable package version owns the tag, and the workflow/ref concurrency key with
`cancel-in-progress: false` prevents two `main` attempts from mutating its draft at once. A
completed rerun is also safe: it checks the tag's exact commit plus the public names and sizes,
then reuses the release instead of applying `--clobber`, whose replacement sequence could
otherwise remove a good public asset and then fail before uploading its replacement. A new release
gets its version from the workflow's planner, which reads the existing tags and releases and applies
the selected version to the working tree only. The resulting new tag cannot overwrite the
preceding stable channel.

For manual dispatch, GitHub evaluates the workflow file from the selected ref, not retroactively
from `main`. The pre-checkout `main` guard therefore protects only refs that contain the corrected
workflow. Push publication is separately restricted by `on.push.branches: [main]`, so the current
tag creation does not match the trigger. The historical incident below records why old refs with a
bare `push:` trigger still required manual workflow disablement at the time.

The workflow contract is checked locally, never in Actions:

```bash
node scripts/check-release-workflow.mjs
npx vitest run src/main/release-workflow-contract.test.ts \
  src/main/release-assets-script.test.ts
```

The checker parses the YAML, follows invoked npm scripts, and verifies command ordering and draft
state. Its gates deliberately mutate the trigger allowlist, pre-checkout `main` guard, stable-version
tag, concurrency, package target, signing
status, draft creation, upload retry, remote verification, and hidden package-script validation;
source-text presence alone is not accepted as evidence.

### Installer acceptance receipts

The packaged acceptance route may receive an installer receipt through
`--installer-receipt <absolute-json-path>`. `scripts/installer-receipt.mjs` validates that receipt
against the exact source commit and recomputes the Setup executable's SHA-256 before promoting it
into the acceptance manifest. A receipt must identify the stable version, package id, product name,
the source commit, and exactly these three Squirrel assets: the product Setup executable,
`RELEASES`, and the matching `-full.nupkg`. The validator rejects `dist/win-unpacked` executables,
delta packages, missing files, changed bytes, and mismatched source or package identity.

The unpacked executable remains useful for the cheap headless interaction route, but it is not
installer evidence. The two claims are kept separate so a successful UI drive cannot accidentally
promote a development directory as a downloadable installer. Visual evidence stays in the
documented capture and issue records; it is not attached to a published release after the
publication step.

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

1. **Workflow timing** — final published notes carry `Workflow started` from GitHub's own
   `run_started_at`, the post-publication `Workflow completed` boundary, and `Workflow duration`
   as stable `HH:mm:ss`. Missing, invalid, or reversed timing fails closed; it is never estimated.
2. **The project's line count at that exact commit**, via `scripts/count-lines.mjs` —
   see below.
3. **What actually ran** — an explicit statement that no tests, type-check, or lint ran in
   this workflow, alongside the real list of steps that did (`npm ci`, then the guarded
   `npm run dist:win` preflight/icon/build/Squirrel/post-package path). This section exists
   specifically so a release is never read as "passing" a check it never ran.
4. **The unsigned-installer warning** described above.
5. **The asset list** (installer filename + size), when the packaging step located any.
6. **A dim-sum code name with an honest public catalog-photo link.** The note generator reads the
   workflow's already-paginated prior-release bodies before selecting a dish, so a successfully
   published code name is not reused. The photo remains hosted by the catalog release and is not
   described as attached to this consumer release.

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
  uncounted rather than silently folded into either total. The committed `build/icon.ico` therefore
  appears as an explicitly uncounted binary asset; generated, gitignored `build/icon.png` is not
  part of the counted ref.
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

The committed binary `build/icon.ico` is listed as an uncounted asset. Generated, gitignored
`build/icon.png` is not part of the Git ref. Everything under `resources/` that is genuinely this
project's own hand-written source (none currently, beyond the license/art exclusions above) stays
in scope for the count; only the paths named above are excluded.

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

1. **The original trigger fix**, `on.push.branches: ['**']`, stopped new tags from starting runs
   only when the selected ref already contained that corrected workflow.
2. **Manually disabling the workflow** in GitHub Actions (`gh workflow disable release.yml` or
   the Actions UI) — this is what actually stopped runs that were still being triggered by
   already-published tags checking out their own, unfixed, copy of the file. The branch filter
   is necessary but was not, by itself, sufficient to end an already-running loop.

The trigger was later restored, but only for the `main` branch. The current committed contract has
`on.push.branches: [main]` alongside `workflow_dispatch`, and its first step still accepts only
`main`. The old tag loop cannot recur through this definition because a created tag is not a branch
push to `main`. A second guard prevents a different automatic loop: the workflow applies its
planned version bump to the working tree only and must contain no `git commit` or `git push`, so it
cannot create another `main` push from inside the release run. `scripts/check-release-workflow.mjs`
enforces both boundaries.

### Recurrence snapshot (2026-08-16)

The 43-release/85-run figures above are the first incident snapshot, not the current hosted
inventory. Unsafe copies of the older push-triggered workflow later ran again from refs that did
not contain the repair. Runs `31966370780` and `31966413527` completed successfully and published
full Squirrel assets; the hosted latest release became `v0.3.0-ci.208` at commit `c42d8ec…`, with
packaged application version `0.3.0`. That CI-suffixed release is not the stable feed authority the
new updater requires, even though GitHub currently treats it as non-prerelease/latest.

At the time of this snapshot, the hosted release workflow was `disabled_manually`, and the
recurrence audit found no queued or in-progress release run. That was the boundary that stopped the
unsafe historical copies; the absence of active runs did not prove those refs had become safe.
Commit `69d2db23` later restored automatic publication for pushes to `main`, with the branch filter,
working-tree-only version update, and no-commit/no-push guard described above. The snapshot remains
here as incident history, not as a description of the current trigger.

### The fail-fast `main` guard

Manual dispatch can select a branch or tag, and the workflow file comes from that selected ref.
So the release job's very first step fails unless `github.ref_type` is `branch` and `github.ref`
is exactly `refs/heads/main`, before checkout or dependency installation. Push-triggered runs are
already limited to `main` by the trigger itself; the step is the independent protection for manual
dispatch.

### The honest cost of an ungated pipeline, restated

The "governing policy" section above already names the trade-off this project has chosen: no
test, type-check, or lint gate on the release pipeline, so a broken commit can reach a published
release before a human notices. The tag-trigger loop is what that trade-off looks like when it
goes wrong in the *other* direction the policy did not originally anticipate: not "one bad build
shipped once," but a runaway trigger turning one broken build into dozens of empty releases in
under an hour, entirely unattended, because nothing in the pipeline's own design could tell it to
stop. An ungated pipeline is not just a pipeline that might publish something broken — it is a
pipeline that, absent an explicit guard, has no internal reason to publish exactly one thing per
change instead of an unbounded number. The `main`-only branch trigger, fail-fast ref guard, and
prohibition on committing or pushing the in-run version change provide that boundary without
reintroducing a quality gate: nothing here runs a test or a linter, tags cannot retrigger the job,
and the job cannot manufacture another push to `main` from inside itself.

## Windows icon provenance

`scripts/make-icon.mjs` contains the original SVG master and deterministically generates the
committed seven-frame `build/icon.ico`. The Windows packaging wrapper derives a raw GitHub URL from
the checkout's full source SHA, refuses a mismatched `GITHUB_SHA` or any dirty/uncommitted source,
requires that commit to be publicly reachable, downloads without credentials or redirects, and
requires HTTP 200 plus exact bytes/SHA-256. That URL is passed as Squirrel's effective `iconUrl`;
the post-package gate requires it in the sole full-nupkg semantic nuspec and compares all seven
icon-frame hashes plus product/version metadata in Setup, `nodeterm.exe`, and
`nodeterm_ExecutionStub.exe`. Squirrel's vendor `Update.exe` remains vendor-branded because the
pinned plugin exposes no supported resource-edit hook; it is explicitly outside this gate.

This closes the old mutable `blob/master/...?...` fallback, which packaged successfully even though
the ignored file returned 404 — the failure mode worth remembering here, because a green package is
exactly what it produced.

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
