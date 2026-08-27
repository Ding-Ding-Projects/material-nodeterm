# Handoff

## 2026-08-27, main-process keyboard interception repair

Release run `33127262674` at `35f76e8fdb8a6921fc7dc2a3caf9ddb2d3ec93cb` passed both coverage checkers,
packaging, provenance, and icon phases, then failed during the application build at
`src/main/index.ts:1448:0` with `Expected ")" but found "app"`. The cause was an obsolete inline
`win.webContents.on('before-input-event', ...)` block that lacked its closing `})`, immediately
followed by the current `installKeydownIntercepts(...)` registration and a duplicated mid-sentence
comment.

The repair removes only the obsolete inline handler and stale rationale. It keeps one coherent
comment and the current helper registration, including `currentInterceptBindings`, recorder
stand-down, terminal-policy stand-down, and fixed physical-code zoom handling. Read-only occurrence
checks showed that `matchesShortcut`, `isMacMain`, and `shouldHideOnClose` were used only by the
deleted or superseded splice, so those imports and the unused modifier constant were removed. The
current `closeAction`, `setMainWindow`, `getMainWindow`, `sendToMain`, and
`createCrashReloadPolicy` uses remain. AWS, Cloudflare, hosted services, diagnostics, browser guests,
updater, account, relay, and no-signing registrations were preserved.

This lane intentionally ran no tests, checkers, lint, type checks, builds, packaging, installer
execution, runtime interaction, reviews, audits, or UI captures. Read-only source and history scans
identified the duplicate registration boundary and import usage. The integration owner must evaluate
the exact commit and the follow-up GitHub Actions run before treating this repair as verified.

## 2026-08-27, main-process parser repair

Release run `33126389977` reached the application build after both coverage checkers and all
packaging and icon phases passed, then failed at `src/main/index.ts:884:4` with
`ERROR: Expected "}" but found "detail"`. The exact cause was a merge splice in the quit-confirmation
section: duplicate `confirmQuit` declarations, duplicate explanatory comments, and two `detail`
properties with contradictory claims about whether terminal sessions survive quitting. The nearby
browser-guest map comments also named two different registration helpers.

The repair keeps the settings-aware `confirmQuit` implementation, the risk-specific warning that
non-persistent terminals end on quit, all quit confirmation state, and the `registerBrowserGuestRequest`
registration path. It removes the duplicate declaration and comment residue, restores valid object
punctuation by retaining one truthful `detail`, and reconciles the browser-guest comment with the
actual adapter function. AWS, Cloudflare, hosted services, diagnostics, browser guests, updater,
account, relay, and no-signing registrations were preserved. No blanket historical restore or
unrelated refactor was used.

This lane intentionally ran no tests, checkers, lint, type checks, builds, packaging, installer
execution, runtime interaction, reviews, audits, or UI captures. Read-only source and history scans
were used to identify the exact duplicate splices. The integration owner must evaluate the exact
commit and the follow-up GitHub Actions run before treating this repair as verified.

## 2026-08-27, Canvas notification inventory repair

Release run `33123084094` at `e6697feb31e5e59f36e916b4e5b00966e9b57891` executed the repaired
coverage checker. Producer manifest, producer uniqueness, speech marker, project-save markers,
surface manifest, and mutation checks passed. The remaining three base failures were the Canvas
notification count, title-ownership, and body-ownership checks, with one aggregate complete-fixture
failure.

An independent parser matching the current `callArguments` algorithm selected 57 production object
payloads. The hand-written Canvas call manifest now contains 57 IDs, with no unmatched calls or
IDs. All 57 selected calls carry `titleKind`; 54 carry a body and all 54 carry `bodyKind`. The
title-marker manifest was expanded for the current placement, unavailable-node, AWS Universe,
media, planner, and project notification calls, while the separate save-cancelled and save-failed
markers remain at one each. Canvas now supplies explicit title and body ownership for every selected
notification payload.

This lane intentionally ran no production checker, tests, lint, type checks, builds, packaging,
installer execution, runtime interaction, reviews, audits, or UI captures. The parser comparison was
read-only and separate from the production checker, so the repair remains unverified by those
activities until the integration owner evaluates the exact merged commit.

## 2026-08-27, personal vocabulary producer and save-notification repair

Release run `33121962513` at `9c5cbc2883c0218ff159cf39874d5e94c1db45c4` executed the coverage checker
and reported eight base failures: the canonical producer mismatch, Canvas notification count and
title/body ownership mismatches, incorrect Project save cancelled and Project save failed marker
counts, the speech-settings marker, and duplicate producer IDs. The complete-fixture check added
one aggregate failure.

The repair keeps one producer row per ID and preserves the strongest boundary for each duplicate:
the exact `const vocab = useVocabularyMapper()` row for `password-manager` and
`authenticator-settings`, the single catalog row for `converter-adapter-catalog`, and the actual
`SettingsText` row for `speech-settings`. The canonical producer list now matches the resulting
126 unique producer rows in exact order. Canvas save handling now emits one cancellation notification
from the cancelled branch and one failure notification from the failure branch, with title and body
ownership retained.

This lane intentionally ran no production checker, scripts, tests, lint, type checks, builds,
packaging, installer execution, runtime interaction, reviews, audits, or UI captures. The repair
remains unverified by those activities until the integration owner evaluates the exact merged
commit.

## 2026-08-27, personal vocabulary coverage parser repair

Release run `33119050796` reached application build after the source identity, resource, icon,
HTTPS, and metadata phases passed, then failed while parsing
`scripts/check-personal-vocabulary-coverage.mjs:306` with
`SyntaxError: Identifier 'CANONICAL_CANVAS_NOTIFY_CALL_IDS' has already been declared`.

The repair removes the obsolete duplicate Canvas notification manifest and duplicate check block,
restores the producer-array separators and duplicate-row cleanup left by the same merge, and keeps
the detailed independent notification manifest that matches the current `Canvas.tsx` title markers.
The notification call pipeline now filters `callArguments` to production object payloads before one
set of inventory, title-ownership, and body-ownership checks. The source shape was inspected
read-only to preserve the current notification title and body boundaries rather than deleting a
manifest entry by guesswork.

This lane intentionally ran no tests, checkers, lint, type checks, builds, packaging, installer
execution, runtime interaction, reviews, audits, or UI captures. The repaired source therefore
remains unverified by those activities, and the integration owner must evaluate the exact merged
commit before treating the release workflow as recovered.

## 2026-08-27, personal vocabulary surface manifest repair

Release run `33121215883` at `c037d569f1ce77bc98fb47c80f2cad4d30a9c977` passed the packaging-wrapper
and icon phases, then failed while evaluating `scripts/check-personal-vocabulary-coverage.mjs:362`
with `TypeError: undefined is not iterable` at the `PRODUCTION_SURFACES` destructuring map.

The repair keeps exactly one current row for each of the 61 production surfaces, retains the mapped
rows where mapped and obsolete unmapped rows overlapped, restores the missing `dictation-overlay`
separator, and updates `CANONICAL_SURFACE_IDS` to the same 61-ID order. The set comparison was
performed read-only outside the production checker and found no duplicate IDs or set differences.

This lane intentionally ran no scripts, tests, checkers, lint, type checks, builds, packaging,
installer execution, runtime interaction, reviews, audits, or UI captures. The repair remains
unverified by those activities until the integration owner evaluates the exact merged commit.

## 2026-08-27, personal vocabulary mutation fixture repair

Release run `33120352944` at `4becb8deb1ee520ebccabcb3bd1d43293c60af00` passed every packaging-wrapper
and icon phase, then failed during application build while parsing
`scripts/check-personal-vocabulary-coverage.mjs:515` with
`SyntaxError: Identifier 'titleMutationCalls' has already been declared`.

The repair removes the obsolete duplicate title and body mutation fixture checks that used the
older object-shape filter. One title mutation and one body mutation now remain, both using the
same production `kind` plus `title` object-payload filter as the main Canvas inventory. No adjacent
duplicate declaration or missing fixture boundary was found after the edit.

This lane intentionally ran no scripts, tests, checkers, lint, type checks, builds, packaging,
installer execution, runtime interaction, reviews, audits, or UI captures. The repair remains
unverified by those activities until the integration owner evaluates the exact merged commit.

## 2026-08-27, Squirrel packaging asynchronous exit repair

The Windows packaging wrapper now keeps its top-level asynchronous entrypoint alive until every
phase settles and writes synchronous start, completion, and failure diagnostics for cleanup,
preflight, resource bootstrap, icon generation, source icon verification, metadata publication,
application build, electron-builder resolution, Squirrel packaging, and packaged-contract checks.
This addresses release run 33114320258, which reached successful QEMU, AWS CLI, and icon-generation
messages and then exited with code 1 without naming a post-icon failure. The unsigned Squirrel policy,
source-SHA icon URL, and package contract remain unchanged.

Changed files are `scripts/windows-installer.mjs`, `docs/features/packaging/packaging-and-auto-update.md`,
`CHANGELOG.md`, and this handoff. No tests, checkers, lint, typecheck, builds, packaging, runtime
interaction, reviews, audits, or captures were run in this lane.

## 2026-08-27, immutable icon transport repair

Release run `33116485248` at `5bb99b39d382cce534637d8661cd02b40ff0549e` showed the awaited wrapper
reached `source icon verification started` and then terminated without completion, failure, or
outer-catch output. The production path now uses a refed Node HTTPS request with an explicit
15-second request deadline, bounded streaming response collection, content-length validation,
status 200 and redirect refusal, exact byte comparison, and ICO validation. The existing injected
fetch-style function remains supported for tests. Source identity, generated-versus-committed icon
comparison, download, and parsing each have their own named diagnostics.

This second repair changed only `scripts/windows-installer.mjs`, this packaging article, the
Unreleased changelog, and this handoff. No tests, checkers, lint, typecheck, builds, packaging,
runtime interaction, reviews, audits, or captures were run.

## 2026-08-27, project-aware navigation, issue #86

This task branch was reconciled with the exact remote `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c` in merge commit `8582d087`. The implementation commit is
`db8189b4d3cf1efc84f4588b28eb2e7b726c32d1`.

The Canvas now owns a transient single-node focus view. A terminal header control, the command-palette
Focus node action, and desktop `F11` promote the selected node into root coordinates. The full source
node set and parent viewport stay in memory, while autosave, explicit save, and canvas synchronization
merge the focused edit back into the owning project. Returning restores the original parent relationship,
nested coordinates, and viewport. Same-project navigation exits focus before resolving a sibling target.

Project-linked navigation keeps ownership explicit: open projects switch normally, closed projects reopen
before focus, unavailable projects are refused, and missing project or node ids are no-ops. No project
display name, stale projection flag, credential, process, provider operation, or external network action
is used as an ownership substitute. Projection, link, grouping, dependency, harness, model, restart, and
account behavior remains outside this branch.

Direct documentation is `docs/features/canvas/project-aware-navigation.md`, indexed from
`docs/features/canvas/README.md` and cross-linked from `docs/features/canvas/canvas-and-lifecycle.md`.
`CHANGELOG.md` and `ROADMAP.md` record the same scope and evidence boundary.

This implementation lane did not run tests, lint, type checks, builds, packaging, runtime interaction,
reviews, audits, or captures. The branch remains separate from the default branch, and no release or cleanup
was performed here.

## 2026-08-27, canvas zones and saved layouts, issue #82

The lane is implemented on `feat/program-71-zones-layouts` and reconciled with the exact
`origin/main` tip `54164b84dce0b7e62787b1de2885405ff4ed821c`. It completes the upstream issue #394
follow-up beyond the v1 zone menu: edge and corner drag previews, half, third, and quarter targets,
and named per-project saved layouts now share one placement and validation path. Saved records carry
only node ids, geometry, grouping, collapsed state, and the viewport. They exclude sessions,
credentials, process state, machine paths, and other runtime data.

The implementation paths are `src/renderer/lib/nodeZones.ts`, `src/renderer/lib/nodeLayouts.ts`,
`src/renderer/canvas/Canvas.tsx`, `src/renderer/state/workspace.ts`, `src/renderer/state/projects.ts`,
`src/shared/types.ts`, and `src/core/workspace-files.ts`. The feature article is
`docs/features/canvas/zones-and-saved-layouts.md`, indexed from the canvas category and noted in
`CHANGELOG.md` and `ROADMAP.md`.

This ultra-speed lane intentionally did not run tests, type checks, lint, reviews, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or captures.
The generated offline documentation bundle was not regenerated because that is a build step; the
next integration lane must run the supported generator and verify the generated output before
claiming the documentation browser is current. The lane was not integrated into `main`, and no
release or cleanup was performed here.

## 2026-08-27, AWS CDK manager, issue #48 PR preparation

The issue branch was reconciled with the exact remote `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c`. The CDK manager is now mounted as the `cdk` mode of
the existing `aws-resource` node and is available through the existing AWS Shop row `aws-cdk`; no
duplicate catalog, profile, credential, or AWS resource manager stack was added.

`src/main/aws/cdk-manager.ts` runs only fixed CDK synth, diff, and deploy actions with a validated
local folder, a bounded trust review, explicit in-memory trust and diff-review tokens, bounded
output and timeout handling, request-id cancellation, and the shared AWS profile and region binding.
`src/renderer/components/aws/CdkManagerPanel.tsx` provides the native folder picker, executable
project-script review, stack selection, local search with its anchored full regex builder, progress,
unavailable states, and the existing two-key confirmation for risky deploys. `src/shared/cdk.ts` and
`src/shared/aws-resource.ts` keep only safe CDK app and stack intent portable; the selected folder,
provider session, generated templates, process state, and credentials remain local.

Direct documentation is `docs/features/integrations/cdk-manager.md`, indexed from both the
Integrations and AWS category READMEs, with a matching `site/docs/cdk-manager.html` page. The
offline `src/shared/docs-data.ts` bundle was not regenerated in this preparation lane. The parent
must regenerate it and verify the generated article before integration.

Commit `b376e55d23d5021b7199629e06b4c58dbd507629` was the earlier pushed feature tip. This follow-up
reconciliation and mounting work is uncommitted in the current checkout until the parent
reviews the merge result. No tests, type checks, lint, builds, packaging, runtime interaction,
reviews, accessibility or security audits, or screen captures were run. The parent owns the next checks,
the downstream and upstream PRs, issue comments and closure, and the final default-branch integration.

## 2026-08-27, Open WebUI hosting implementation, issue #54

Issue #54 is implemented on `feat/program-43-open-webui-hosting`. The lane adds the typed
`open-webui-hosting` node kind, a guided renderer panel, a pinned official Open WebUI image, local
Ollama reuse, an OpenAI-compatible provider choice, honest first-user setup and health states, and
fixed-action deploy, backup, restore, update, rollback, and cancellation handling.

Portable project data carries only `openWebUiIntent`: provider mode, model, Ollama reuse, and port.
The selected Docker context, node-owned container and volume, endpoint, optional provider URL,
image history, backup timestamp, and credential reference remain in the machine-local
`open-webui-bindings.json` overlay. Import is data-only and does not contact Docker, pull an image,
deploy, launch a process, or mutate a provider. Archive restore validates member paths and is gated
by the existing two-key destructive confirmation. Provider secrets are never accepted in URLs,
commands, project data, logs, or exports.

Direct documentation is in `docs/features/hosting/open-webui-hosting.md`, its category index,
`site/docs/open-webui-hosting.html`, the in-app generated `src/shared/docs-data.ts` entry, and the
canvas node-kind article. `README.md`, `ROADMAP.md`, and `CHANGELOG.md` record the same scope.

The active ultra-speed implementation boundary was honoured: no tests, type checks, lint, reviews,
security or accessibility checks, builds, packaging, installer execution, runtime interaction, or
UI captures were run. The docs bundle generator was attempted but could not run because `esbuild`
is absent from this checkout; the generated offline article entry was updated directly and remains
subject to the owning integration lane's normal bundle check.
## 2026-08-27, AWS platform managers, issue #49

The issue branch was reconciled non-destructively with exact `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c`. Upstream already supplied the canonical AWS stack in
`src/shared/aws-resource.ts`, `src/core/aws-resource-manager.ts`, `src/core/aws-resource-register-ipc.ts`,
and `src/renderer/nodes/AwsResourceNode.tsx`. The earlier duplicate plural manager stack was retained
in its historical commits but is not used by the resulting tree.

Program 38 is now mounted through that shared manager. `src/shared/aws-resource.ts` adds typed
platform-manager modes and operations for ECR, ECS, EKS, RDS, database, VPC, Route 53, and cost
management. `src/core/aws-resource-manager.ts` builds fixed argument arrays with `shell: false`,
validates bounded values, parses bounded JSON, handles pagination and primitive list results, and
redacts response fields before renderer delivery. `src/renderer/nodes/AwsResourceNode.tsx` adds
the platform-manager mode, service tabs, typed controls, generated previews, result search with
its anchored regex builder, progress, cancellation, retry, and the existing two-key destructive
confirmation. `src/shared/node-catalog.ts`, `Canvas.tsx`, and `workspace.ts` make the eight rows
current AWS Universe entries that create the shared `aws-resource` node with portable safe intent.

Direct documentation is `docs/features/integrations/aws-container-database-cost-managers.md`, its
category/index links, and `site/docs/aws-container-database-cost-managers.html`. The generated
offline docs bundle was not regenerated because this lane forbids builds.

Verification boundary: no tests, lint, type checks, builds, packaging, runtime interaction, reviews,
security or accessibility checks, installer execution, or UI captures were run. No issue, pull
request, default-branch, or cleanup mutation was performed. The feature branch was pushed to
`origin/feat/program-38-aws-containers` and retained for downstream integration.
## 2026-08-27, generic all-service AWS GUI, issue #50

The issue branch is `feat/program-39-aws-all-services`, reconciled with the exact
`origin/main` tip `54164b84dce0b7e62787b1de2885405ff4ed821c`. The generic lane now uses the current
AWS Universe Shop and shared AWS resource manager rather than maintaining a second AWS execution
stack. `ShopNode.tsx` routes the all-service entry to the installed-model service and operation
pickers, while `AwsOperationWizard.tsx` supplies typed controls for structures, unions, lists, maps,
enums, booleans, numbers, dates, times, files, and synchronized JSON or YAML views. Every picker
search has its own anchored regex builder.

`AwsResourceManagerService` accepts a model-generated `generic` operation, reloads and validates the
current wizard model before generating argv, adds the selected local profile, region, output, and
bounded pagination settings, and invokes the bundled AWS CLI through the existing `shell: false`
runner. Previews include the service, operation, profile, region, risk, pagination, retry, endpoint,
and argv. Destructive operations remain behind the existing two-key confirmation flow. Results are
bounded and redact credential-shaped fields. Desktop and Server Edition register the same shared
manager, while relay tabs retain an explicit unsupported state.

The direct records are `docs/features/integrations/aws-all-services.md`,
`site/docs/aws-all-services.html`, the integrations index, `CHANGELOG.md`, and `ROADMAP.md`. The
earlier duplicate `src/core/aws-all-services.ts`, `src/shared/aws-all-services.ts`, and standalone
AWS panel were removed after reconciliation, because they duplicated the existing AWS manager and
would have allowed the two execution paths to drift.

The implementation lane intentionally ran no tests, type checks, lint, builds, packaging, installer
execution, runtime interaction, reviews, accessibility or security audits, or screenshots. The parent
integration lane owns those checks and the default branch merge.

## 2026-08-27, Cloudflare Tunnel inventory implementation, issue #59

Issue #59 is implemented on `feat/program-48-tunnel-inventory` in the isolated task-owned
worktree. `src/shared/cloudflare-tunnels.ts` defines bounded tunnel, route, DNS, conflict, adoption,
progress, and schema 3 portable-intent contracts. Route validation rejects wildcard or malformed
hostnames, unsafe paths, credential-bearing origins, and any attempt to disable existing-route
preservation. Conflict planning distinguishes an existing route, another tunnel, and an existing
DNS record. DNS adoption keeps an existing CNAME unchanged unless the user explicitly chooses the
single-record replacement path and types `ADOPT <hostname>` before the app's two-key confirmation.

`src/core/cloudflare/tunnel-service.ts` owns the HTTPS Cloudflare API calls, bounded pagination and
response parsing, local route metadata, and token resolution through the existing Cloudflare core
credential manager. `src/core/cloudflare/
register-ipc.ts`, `src/shared/ipc.ts`, `src/shared/types.ts`, the preload, Server Edition bridge,
and relay refusal wire the typed API without exposing a raw request editor or token. The renderer
manager is `src/renderer/components/cloudflare/CloudflareTunnelInventoryPanel.tsx`, mounted by the
new `cloudflare-tunnel` service node with independent plain-text-first searches and anchored regex
builders for tunnels, routes, and DNS records.

Direct documentation is in `docs/features/remote/cloudflare-tunnel-inventory.md`, its category
index, and `site/docs/cloudflare-tunnel-inventory.html`; the changelog and roadmap record the same
state. The generated offline documentation bundle was not regenerated in this lane because the
ultra-speed boundary forbids build work; the integration owner must run the supported docs-bundle
generation before packaging.

No tests, type checks, lint, reviews, security or accessibility checks, builds, packaging, installer
execution, runtime interaction, or UI captures were run. The source is therefore unverified at
runtime and the parent integration lane must run its own checks against the merged commit.
## 2026-08-27, cloudflared connector runtimes, issue #61

The implementation lane is `feat/program-50-cloudflared-runtimes` in the isolated issue-61
checkout, reconciled with `origin/main` at `54164b84dce0b7e62787b1de2885405ff4ed821c`. The
Program 50 commit `051f409d4102f1287759a1686d54fd6cbed36641` defines the typed per-user process,
Windows service, and Docker connector contracts, fixed argument builders, guided picker inventory,
disabled reasons, bounded progress and health shapes, local ownership fields, and schema 3 portable
blueprint. The main-process manager owns discovery, protected credential storage, token-file
materialization, process/service/container lifecycle, cancellation, restart, health reads, and local
runtime records. The current Cloudflare Zero Trust and tunnel stack from `origin/main` is preserved.

Direct records remain current in `docs/features/remote/cloudflared-runtimes.md`,
`site/docs/cloudflared-runtimes.html`, `docs/features/remote/README.md`, `site/docs/index.html`,
`docs/uh-feature-inventory.md`, `ROADMAP.md`, `CHANGELOG.md`, and this handoff. The offline docs
bundle entry is updated to the normalized article. Its documented generator could not run because
this checkout has no installed `esbuild` dependency; the integration lane must regenerate and verify
the bundle.

No tests, type checks, lint, reviews, security or accessibility checks, builds, packaging, installer
execution, runtime interaction, or UI captures were run in this ultra-speed implementation lane.
The owning integration lane must verify the exact merged commit and may not infer those verdicts
from source inspection.

## 2026-08-27, Cloudflare Tunnel state model implementation

Issue #62 is implemented on `feat/program-51-tunnel-state` at the source level and reconciled with
`origin/main` at `54164b84dce0b7e62787b1de2885405ff4ed821c`. The shared
`src/shared/tunnel-state.ts` module keeps API creation, DNS routing, connector health, Access policy,
origin reachability, and external reachability as six separately timestamped facets. Each facet now
also carries its source and evidence. Transitions are bounded, reject stale observations, require a
fresh check after failure, and preserve `unknown` as a distinct state when no trustworthy observation
exists. Schema 3 intent is limited to the node label, hostname, origin protocol and port, connector
mode, access-policy intent, and route mode. Provider ids, connector ids, process state, local paths,
credentials, and observations are local-only.

`src/core/cloudflare-core-managers.ts` now owns local state, per-node generations, cancellation, and
bounded probe expiry, and publishes complete state events through typed IPC. Desktop preload,
Server Edition handlers, the WebSocket bridge, and unsupported-surface stubs expose the same API.
`src/renderer/nodes/CloudflareCoreManagersNode.tsx` mounts
`src/renderer/components/tunnel/TunnelStatePanel.tsx`, whose plain-text check search and status filter
each own an adjacent anchored full regex builder. Rows show independent status, bounded detail or
recovery reason, timestamp, source, evidence, and a retry control with an explicit disabled-state
reason. The current Cloudflare stack has no tunnel-specific provider or connector probes yet, so a
configured binding remains visibly `unknown` with source `unavailable`; no binding is `blocked` with
a Configure recovery action.

Direct documentation is in `docs/features/remote/cloudflare-tunnel-state.md`, indexed from
`docs/features/remote/README.md`. The static documentation site has the matching
`site/docs/cloudflare-tunnel-state.html` article and index link. `CHANGELOG.md` and `ROADMAP.md`
record the source state and the remaining verification boundary. The generated offline docs bundle
was not rebuilt in this lane because the requested ultra-speed boundary forbids builds and runtime
work.

The lane intentionally did not run tests, type checks, lint, reviews, security or accessibility
checks, builds, packaging, installer execution, runtime interaction, or captures. The next owner
must wire the panel into the Cloudflare tunnel node and host APIs, regenerate the offline bundle,
then run the appropriate focused verification against the integrated commit.
## 2026-08-27, Kiosk and PWA sessions implementation, issue #64

The implementation lane is `feat/program-53-kiosk-pwa`, refreshed to `origin/main` at
`30e73b7e4a518d46a2f64887a3eb4eadec907caa` before edits. The lane adds the shared kiosk/PWA intent
contract in `src/shared/kiosk-pwa.ts`, a host-neutral owner-scoped lifecycle manager in
`src/core/kiosk-pwa.ts`, and `KioskPwaNode` plus `KioskPwaSetupDialog` for the browser-backed canvas
surface. The Node Catalog now exposes Kiosk session and PWA session entries, and browser node
serialization carries only validated portable intent.

Secure URLs reject credentials, unsafe schemes, control characters, and non-loopback HTTP. PWA
choices come only from an installed-app inventory, so an unavailable inventory stays visibly empty.
Popups are disabled and permission events are denied by default. Local profile keys and runtime
lifecycle stay outside the project projection. Exit, Retry, owner checks, unavailable states, and
recovery copy are explicit.

Direct documentation is in `docs/features/remote/kiosk-pwa-sessions.md`, its category index, the
generated offline article record, and `site/docs/kiosk-pwa-sessions.html`. `CHANGELOG.md` and
`ROADMAP.md` record the same delivery boundary.

This ultra-speed lane intentionally ran no tests, type checks, lint, reviews, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or captures.
The documentation-bundle generator was attempted but could not run because this checkout has no
installed `esbuild` package. The offline article record was updated manually to keep the committed
bundle aligned with the new article; the integration lane should regenerate and compare it after
bootstrapping dependencies.
## 2026-08-27, read-only Windows diagnostics, issue #66

The implementation lane is `feat/program-55-windows-diagnostics` in the linked checkout
`C:\Users\cntow\Documents\GitHub\material-nodeterm-worktrees\issue-66`. It adds the
`windows-diagnostics` node kind, the typed `windowsDiagnostics` bridge, and a core snapshot service
that invokes only one fixed, read-only PowerShell script. The script reports drives/storage,
services, startup entries, scheduled tasks, updates, network state, and bounded System/Application
event summaries. It has a fifteen-second query deadline, a four MiB response bound, and a 1,000-row
per-section bound. Non-Windows hosts, missing providers, command failures, and malformed responses
remain explicit unavailable/error states instead of empty success.

The canvas node exposes a tab for each section, a local plain-text-first filter, and the adjacent
anchored full regex builder. It contains only refresh and rename interactions; no host mutation
control is present. Snapshot output and host-specific facts remain runtime-local and are not added
to portable project data. Direct documentation is in
`docs/features/windows/windows-diagnostics.md`, with the category index at
`docs/features/windows/README.md`; the offline bundle has a corresponding article entry in
`src/shared/docs-data.ts`.

This feature ref was non-destructively reconciled with the exact `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c` in merge commit
`538fe6a5b4cbf0384a35ff9edc1a1d59d87df431`, preserving the diagnostics lane and incoming default
branch work. The reconciled commit was published to `origin/feat/program-55-windows-diagnostics`,
and its ancestry was verified with `git merge-base --is-ancestor`.

Verification boundary: this ultra-speed lane intentionally ran no tests, lint, type checks, builds,
packaging, installer execution, reviews, security or accessibility checks, runtime interaction, or
captures. The parent integration lane must keep those verdicts unverified.
## 2026-08-27, seamless agent messaging, issue #69 / Program 58

This lane adds `Settings.agentSeamlessWrites`, defaulting to `false`, and a searchable Settings →
Agents row. Agent `send` and `reply` requests use the existing confirmation surface while the
switch is off. When enabled, they call the same main-process mailbox delivery path without opening
the repeated per-message confirmation. Project capability consent, source and target scope checks,
idle-target checks, restart serialization, rate limits, bounded queue outcomes, and delivery traces
remain in force. Node closing remains confirmation-gated.

The upstream PR #113 receive-phase defect was already refined on this base to the bounded
`CONTROL_CEILING_MS` handoff. This lane preserves that ceiling rather than disarming the socket.

Changed implementation and documentation paths include `src/renderer/canvas/Canvas.tsx`,
`src/renderer/components/settings/sections/AgentsSection.tsx`, `src/shared/types.ts`,
`docs/features/agents/agent-messaging.md`, `docs/features/agents/README.md`,
`src/shared/docs-data.ts`, `CHANGELOG.md`, and `ROADMAP.md`.

The canonical docs generator could not start because this isolated checkout has no `esbuild`
installation. The offline bundle entry was reconciled manually. This ultra-speed lane intentionally
did not run tests, type checks, lint, reviews, security checks, accessibility checks, builds,
packaging, installer execution, runtime interaction, or UI captures. The feature branch was not
merged into `main` and no cleanup was performed in this lane.
## 2026-08-27, per-account node colour and binding, issue #71

This lane is implemented on `feat/program-60-account-node-color`, reconciled with the exact
`origin/main` tip `54164b84dce0b7e62787b1de2885405ff4ed821c`. It ports the account colour and single
binding decisions from upstream PRs #283 and #319 for the current Claude and Codex account model.
`ClaudeAccount.color` and `CodexAccount.color` are optional settings values. The Accounts section
writes them through one shared swatch component, and new nodes capture the colour from the account
list owned by their builtin agent. Matching ids in the Claude and Codex lists stay independent.
Empty, malformed, stale, or missing values fall back to the builtin agent colour.

`src/shared/agents/account-binding.ts` provides the shared predicate for the persisted account id.
`src/core/project-node-append.ts` and the host bridge apply the same account binding and use the
host-resolved colour for phone-registered nodes. Account colour remains presentation-only and is
not a credential, path, process, or portable execution field. Existing nodes keep their stored
colour when an account setting changes.

This source lane intentionally did not run tests, lint, type checks, builds, packaging, installer
execution, runtime interaction, reviews, security or accessibility audits, or captures. The offline
documentation bundle was not regenerated. The parent integration lane must verify the merged tree,
run focused checks, regenerate `src/shared/docs-data.ts`, handle issue progress and closure, and
keep the account feature's unverified state honest until those checks land. No release or cleanup
was performed in this lane.
## 2026-08-27, per-session emoji and picture icons, issue #72

The session-icon lane is on `feat/program-61-session-icons` at merge commit
`49ddccd40f37f57c11f4eb330d7f870fb92f4a9f`, which reconciles the feature with exact `origin/main`
tip `54164b84dce0b7e62787b1de2885405ff4ed821c`. The implementation follows upstream PR #293 and
issue #291, adapted to this repository's current renderer and session APIs.

`src/shared/node-icon.ts` defines the bounded emoji and image-path contract. It keeps one grapheme,
removes control characters, accepts only known image extensions, refuses relative traversal, and
supports both POSIX and Windows absolute paths. Project-local images are stored as safe `./`
paths; SSH, cwd-less, and local fallback images remain absolute and local. The value is normalized
when persisted project data becomes live state and again when live state is serialized.

The shared picker and image loader are in `src/renderer/components/NodeIconPicker.tsx`,
`src/renderer/components/NodeIcon.tsx`, `src/renderer/lib/nodeIconChoice.ts`, and
`src/renderer/lib/nodeIconImage.ts`. The same mark renders in the canvas terminal header, Kanban
card, card modal, and sessions sidebar row. Terminal context menus expose Set icon or Change icon,
and Remove versus Cancel remain distinct outcomes. The card modal and header controls expose
accessible labels, while the picker keeps keyboard focus on its input and uses the existing local
file picker and durable canvas-image writer.

Direct documentation is `docs/features/canvas/node-icons.md`, indexed from the Canvas category.
`CHANGELOG.md` and `ROADMAP.md` record the same source-only boundary. The generated offline docs
bundle was not regenerated. No tests, lint, type checks, builds, packaging, runtime interaction,
reviews, audits, or UI captures were run. The parent integration lane owns those checks, the
dedicated pull request, issue comments and closure, and any later bundle regeneration.
## 2026-08-27, first-class Files node, issue #73

The Files node lane is being reconciled on `feat/program-62-files-node` against the exact
`origin/main` tip `54164b84dce0b7e62787b1de2885405ff4ed821c`. The implementation source commit is
`d00d7c6c483a51468eb431a070a6b3032e5aadd4`, based on upstream PR #294 commit
`462182664e3339792424f55f7b81764b48c68c12`.

The canvas now has a persisted `files` node with one directory listing, breadcrumb and parent
navigation, refresh, local file and folder creation, path copy, local file-manager reveal, file
opening through the existing canvas routing event, and a terminal-in-folder action. Its search is
plain-text-first and uses the shared adjacent anchored regex builder with bounded candidate
matching. Loading, read failure, empty directory, and no-match states remain distinct. SSH and
relay listings stay on their owning filesystem, remote paths never reach the local operating-system
opener, and worktree removal displaces stale directory nodes by path.

The feature is documented in `docs/features/files/files-node.md` and indexed from
`docs/features/files/README.md`. `CHANGELOG.md` records the same scope and verification boundary.
The current origin/main reconciliation also carries the latest shared filesystem bridge and shell
changes without changing the Files node's local path or portability semantics.

This ultra-speed lane intentionally did not run tests, lint, type checks, builds, packaging,
installer execution, runtime interaction, reviews, audits, security or accessibility checks, or
UI captures. The parent integration lane owns those checks, offline documentation regeneration,
main integration, release evidence, and issue records. No issue or pull request mutation was done
by this lane.
## 2026-08-27, display-only agent-state recovery and workflow grouping, issue #74

The implementation is on `feat/program-63-agent-state-recovery`. It was reconciled with the exact
`origin/main` tip `54164b84dce0b7e62787b1de2885405ff4ed821c` in merge commit `82b2dcde6525f7831f0e7bd44c2fd33634b2650e`.
The feature commit is `90c8d0d9f7b6d355448f2c357bf6376583929667`.

The core mirror now keeps a lifecycle-bound `lastKnown` display snapshot separate from expiring
operational state. Claude and Gemini transcript tails, plus Codex app-server thread status, can be
inspected through the shared `agent-status-snapshot` handler. Recovery is bounded and fail-safe:
missing, malformed, stale, unsupported, or remote evidence does not become a guessed completion.
Recovered state is explicitly display-only and cannot drive notifications, authorization, process
control, or hibernation. A live hook event always wins the request race, and session boundaries
preserve only same-conversation display continuity.

Desktop preload, Server Edition, and the WebSocket bridge expose the snapshot route. Renderer rows
label recovered ages as `last known`, and the hibernation policy refuses recovered rows until live
evidence arrives. The sessions sidebar groups by workflow state in the order Need attention, Done,
Unknown, and Running. Unread stays a row-level notification affordance, so it does not move a row
out of its actual workflow section.

Directly related source files include `src/core/agent-status-recovery.ts`,
`src/core/agent-status-handlers.ts`, `src/core/agent-status-mirror.ts`,
`src/shared/agents/status-snapshot.ts`, the Desktop and Server bridge registrations,
`src/renderer/state/agentStatus.ts`, `src/renderer/lib/sessionList.ts`,
`src/renderer/terminal/hibernation-policy.ts`, and the corresponding focused test records and
fixture. Public documentation is current in `docs/features/agents/agent-support.md` and
`docs/features/agents/README.md`; the root changelog carries the same scope and boundary.

The generated offline documentation bundle was not regenerated because this lane explicitly forbids
builds and checks. The parent integration lane must regenerate it before claiming offline docs are
current. This lane also did not run tests, type checks, lint, builds, packaging, runtime
interaction, reviews, security or accessibility checks, or captures. No issue, pull request,
release, default branch merge, deletion, or cleanup mutation was performed by this lane.
## 2026-08-27, named terminal profiles, issue #77 and upstream issue #286

The feature branch was reconciled with the exact `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c`. The named-profile implementation remains in
`68277d44f8ac6000e723c9cd85a6acbeef8e40bf`, with the portability correction in
`8d40fb8ec9312d8e0a5ee922556a7601b4e8494f`.

Settings now stores bounded named profiles containing a display name, initial directory, and
optional startup command. The Settings → Shell surface provides create, edit, remove, default
selection, native folder browsing, and local search with an adjacent regex builder. The node
catalog offers the saved profiles when creating Terminal and Agent nodes. Existing detected shell
profiles remain intact and continue to enumerate PowerShell 7, Windows PowerShell, Command Prompt,
Git Bash, WSL distributions, and custom executables.

Named profile ids and directories use the machine-local execution overlay. Named directories are
removed from portable project content and peer traffic, while the local overlay restores the
selected directory for the owning machine. SSH, relay, Server Edition, and non-Windows surfaces do
not apply the local named-profile picker. Startup commands remain local one-shot launch intent, and
an Agent launch runs after the named startup command.

Direct documentation is `docs/features/terminals/windows-shell-profiles.md`, indexed from
`docs/features/terminals/README.md`. `CHANGELOG.md` and `ROADMAP.md` record the same scope and
verification boundary. Tests, lint, type checks, builds, packaging, runtime interaction, reviews,
audits, and captures were not run in this lane. The parent integration lane owns those checks,
generated documentation refresh, issue comments, final default-branch integration, and release work.
## 2026-08-27, custom alert sounds lane, issue #78

Issue #78 implements the requested custom per-event alert sounds from upstream issue #289 on
`feat/program-67-custom-alert-sounds`. The existing synthesized `done` and `needsYou` cues remain
the fallback. `src/shared/types.ts` adds bounded custom sound records to persisted settings, while
`src/renderer/lib/sfx.ts` reads, decodes, caches, and plays a selected file without allowing a
missing or corrupt file to break the alert path. `src/renderer/components/settings/sections/NotificationsSection.tsx`
adds a real per-event audio picker, filename state, preview, replacement, reset, and precise
validation copy. Sound bytes are stored in the app's settings data rather than a path local to the
browser client, so Server Edition can replay them on its host through the same renderer.

Implementation source tip: `c54c4e1944bd86b02afa2543291cdfc8377b2a5e`.

The accepted input bound is 8 MB and 30 seconds. Empty, non-audio, malformed, undecodable, and
overlong selections are rejected without replacing the last valid selection. Clearing an entry
returns immediately to the built-in synthesized cue. The direct implementation and documentation
records are `src/shared/types.ts`, `src/renderer/lib/sfx.ts`,
`src/renderer/components/settings/sections/NotificationsSection.tsx`,
`docs/notifications.md`, `CHANGELOG.md`, and `ROADMAP.md`.

This ultra-speed lane intentionally did not run tests, type checks, lint, reviews, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
The feature branch was not integrated into `main`, no release was published, and no cleanup was
performed in this lane.
## 2026-08-27, nested Git repository discovery, issue #79

The nested repository discovery lane is being reconciled with the exact `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c`. The implementation from `4cefe4afd5a0eff695833f8e5d72c90a1c669b3b`
adds a read-only, three-level scan for child Git checkouts, typed IPC and relay routing, and
Source Control scopes for verified child paths. The reconciled update adds opaque paging, a 512
directory traversal limit, explicit scan metadata, lexical containment checks, and a lstat plus
realpath boundary that skips symbolic links, junctions, and other reparse-point paths before
traversal. Discovery never initializes, mutates, deletes, or publishes a repository.

The Source Control panel exposes the child scopes through the shared searchable picker and shows
partial-read or safety-limit results separately from an empty scan. SSH projects retain an honest
unsupported state because a local process cannot inspect the remote filesystem. Direct documentation
is `docs/features/source-control/source-control-and-worktrees.md`, indexed from the Source Control
category; `CHANGELOG.md` and `ROADMAP.md` carry the same scope and verification boundary.

No tests, type checks, lint, builds, packaging, runtime interaction, reviews, audits, or screen captures
were run in this ultra-speed lane. The generated `src/shared/docs-data.ts` bundle remains pending
because `esbuild` is absent from this checkout and this lane does not install dependencies or run
builds. The parent owns the final current-main integration, offline-bundle regeneration, release
evidence, and any later verification.
## 2026-08-27, bounded typed link endpoint model, issue #86

This source lane was reconciled with the exact `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c`. Commit
`20a57197b6d470d03a8e7d7f3e2cff73a7f16c03` adds the platform-free shared validator in
`src/shared/link-model.ts`. It accepts the discriminated `Endpoint` forms `node`, `xnode`, and
`branch`, the `context`, `lineage`, and `dependency` kinds, and project-owned `Link` records.

The validator bounds identifiers, endpoint components, metadata depth, metadata keys, metadata
bytes, and total link count. It rejects unknown fields, malformed values, unsafe metadata names,
absolute or traversing repository paths, duplicate ids, self-links, missing local endpoints,
foreign mutation sources, and foreign references that point back at the local project. Foreign
nodes are references only and are never mutated by this model.

The direct article is `docs/features/canvas/link-endpoint-model.md`, indexed from the Canvas
category. `CHANGELOG.md` records the same scope and verification boundary. Legacy `bridges` and
`ropes` fields, migration, persistence wiring, cross-project projection, navigation, grouping,
dependency execution, model switching, restart behavior, account behavior, and user-facing link
authoring remain outside this lane for their dedicated owners.

This source lane intentionally did not run tests, lint, type checks, builds, packaging, runtime
interaction, reviews, security or accessibility audits, or captures. The parent integration lane
must wire the validator into every relevant persistence boundary, regenerate the offline
documentation bundle, and perform the remaining verification before merging. No GitHub issue or
pull request mutation was performed by this lane.
## 2026-08-27, persisted link migration, issue #86 and upstream PR #422

The link migration is present on the assigned branch at `feat/program-75-link-migration`, reconciled
with the exact `origin/main` tip `54164b84dce0b7e62787b1de2885405ff4ed821c`. The source integration
is commit `24edc040d38366f9dbc7e85549d3adf38997b6bc`, which carries the two-file migration change
from commit `eb9147af08606da84927a57c0faae7abf949247b`.

`src/core/workspace-files.ts` now provides `migrateLinks`, mapping `bridges` to context links and
`ropes` to display-only lineage links while preserving ids. New project saves emit `links` only.
`src/core/workspace-store.ts` applies the same conversion to inline projects and to the
`persistedCanvases()` snapshot for inline, cached SSH, and local project data. Existing `links`
content wins over stale legacy arrays, and empty legacy collections remain absent.

Direct documentation is `docs/features/projects/persisted-link-migration.md`, indexed from the
Projects category. The changelog records the same scope and verification boundary. The generated
offline documentation bundle was not regenerated because this lane explicitly forbids builds and
checks; the parent integration lane must regenerate it and verify the bundle.

This lane intentionally did not run tests, lint, type checks, builds, packaging, runtime
interaction, reviews, accessibility or security audits, or captures. Endpoint modeling, navigation,
foreign-node projections, cross-project relationships, grouping, dependency operations, harness
behavior, model switching, restart behavior, and account behavior remain owned by their separate
branches. The parent owns the final integration review and any issue or pull-request updates.
## 2026-08-27, cross-project link transport and storage, issue #86

The feature branch was reconciled with the exact `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c`. The current default source already contains the
integrated link transport commit `fd1cb6c968ea4ef7c36befb64f7c6dc154c3a0f9`, which includes the
Canvas-owned commit funnel, unified `Project.links` persistence, local node-only context-map
extraction, and Server Edition persisted-canvas transport. The feature branch also preserves the
earlier source commit `08d3b2169177bf85155301a64a26818f69484e3d` in its history without rewriting
the pushed record.

Direct documentation is `docs/features/projects/cross-project-link-transport.md`, indexed from
`docs/features/projects/README.md`. `CHANGELOG.md` and `ROADMAP.md` record the same scope and
verification boundary. The generated `src/shared/docs-data.ts` bundle was not regenerated because
this lane explicitly forbids builds; the parent integration lane must regenerate it before treating
the offline article as current.

This lane excludes endpoint modeling, legacy migration, foreign-node projections, navigation,
grouping and drill-through, dependency operations, custom-agent harness, model switching,
restart-on-subscription, and account behavior. No tests, lint, type checks, builds, packaging,
runtime interaction, reviews, audits, or captures were run. No public issue mutation, main merge,
release, or cleanup was performed by this lane. The parent owns final verification, integration,
issue progress, and closure.
## 2026-08-27, repository grouping and linked-project drill-through, issue #86

This feature checkout was reconciled with exact `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c` in merge commit `cc2a1941`. The implementation commit
`451605b314c709da56c67bc176c78424898ecc26` adds repository-root session grouping, per-project
repository-root facts, active-repository unbound worktree rows, reversible group drill-through,
and safe linked-project `projectRef` drill-through. Local and SSH projects remain separate, group
edits merge back into the complete parent snapshot, and missing, unavailable, or closed linked
projects remain visible but cannot be opened.

Direct documentation is `docs/features/canvas/grouping-and-drill-through.md`, indexed from
`docs/features/canvas/README.md`. `CHANGELOG.md` records the same scope and verification boundary.
No tests, lint, type checks, builds, packaging, runtime interaction, reviews, audits, or captures
were run in this lane. The parent integration lane owns those checks, any docs-bundle regeneration,
main integration, issue comments, release work, and cleanup.
## 2026-08-27, guided branch dependency operations, issue #86

This task branch was reconciled with the exact `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c`, preserving the reviewed dependency-operation commit
`e78ab1084216b62d289f9c015c24a9284a272d10` in the merge history. The direct implementation now
includes the shared operation inventory and planner in `src/shared/dependency-operations.ts`, the
shared `branchParentConfigKey()` helper, and typed Git IPC, preload, and Server Edition bridge
forwarding.

`src/core/git-service.ts` retains the five reviewed operations, adds bounded command output, and
exposes a guided operation runner with project id and exact link id ownership checks. It reports
queued, running, completed, failed, cancelled, and unavailable states. Only fixed `git` and `gh`
argv forms are emitted. Branch refs are bounded and revalidated, paths are bounded, proposal output
is bounded, cross-project and mismatched repository links are refused, and ship verifies that its
target checkout is actually on the named parent before using `--ff-only`. A queued operation can be
cancelled, while a running operation reports its actual process result rather than fabricating a
stop acknowledgement.

The direct feature article is `docs/features/source-control/dependency-operations.md`, indexed from
the Source control category. The generated offline documentation bundle was not regenerated because
this lane forbids builds and checks. Tests, type checks, lint, builds, packaging, runtime interaction,
reviews, audits, and captures were not run. Renderer link authoring, link rendering, project-link
storage, and the parent integration remain owned by their respective lanes.
## 2026-08-27, custom agent harness persistence, issue #86

This feature branch is reconciled with the exact current `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c`. The custom harness implementation is committed as
`20ce2fe4a974a388c7fea6adcae116f2d6bb9ab6`, with the current-main reconciliation pending in this
follow-up merge commit.

The bounded slice covers `agentBaseId` persistence, shared harness resolution for launch and resume,
hook capability routing, remote hook capability routing, inherited pane-binary recognition, and
custom harness icon and mascot identity. Current main's registered executable and terminal-profile
allowlists, semantic profile picker, reviewed launch preview, bounded argument and environment
handling, working-directory validation, arbitrary-shell refusal, and secret redaction remain
preserved.

Direct documentation is `docs/features/agents/custom-agent-harness.md`, indexed from the Agents
category. The changelog and roadmap carry the same boundary. No tests, lint, type checks, builds,
packaging, runtime interaction, reviews, audits, or captures were run in this source lane. The
parent integration lane owns those checks, the final default-branch merge, issue updates, and closure.
## 2026-08-27, per-node model switching, issue #86 and upstream PR #422

The model-switching branch was reconciled with the exact current `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c` by merge commit `0138fc8aed83b9075d3d5678ec4446ce97cbdd40`.
The source slice is present in the shared agent
capability and model-gateway modules, launch assembly, node/project persistence, Canvas context
menu, TerminalNode recycle choreography, and host-side foreground ownership checks.

The direct article is `docs/features/agents/model-switching.md`, indexed from the Agents category
and linked from `docs/features/agents/agent-support.md`. It records available-model enumeration,
explicit user choice, future-node versus running-node behavior, relay and project ownership,
failure recovery, and the model-switching source locations. A stale same-model callback now stops
before foreground termination or session recycling, and a recycle rejection leaves node data
unchanged instead of claiming that the new model is active.

The selected model remains per-node `agentModel` state. A future node applies it through the normal
launch path. A running node retains its provider session identity, validates harness ownership,
terminates only the expected foreground process, recycles the persistent session, and resumes with
the selected model and current gateway environment. Gateway credentials remain host-side and are
never placed in a launch command.

No tests, lint, type checks, builds, packaging, runtime interaction, reviews, audits, debugging,
or screenshots were taken, per the lane boundary. The generated offline documentation bundle was not
regenerated because that requires the prohibited build step. The parent integration lane owns those
checks and the final bundled-doc verification. No public issue or pull-request mutation was made.

## 2026-08-27, AWS core-service managers, issue #46 PR preparation

The issue branch was reconciled with the exact `origin/main` tip `2472cf23b99559005476841d3db5e6bc4691ac06`.
The earlier standalone AWS core-service stack was removed. The current AWS Resource Explorer and Cloud
Control stack now owns the complete core-service lane through `src/shared/aws-resource.ts`,
`src/core/aws-resource-manager.ts`, `src/renderer/nodes/AwsResourceNode.tsx`, and the existing AWS
Shop routes.

The AWS Shop entries `aws-s3`, `aws-ec2`, `aws-iam`, `aws-sts`, `aws-lambda`, `aws-cloudwatch`, and
`aws-logs` are now current and scope-bound to AWS Universe canvases. Each creates the shared
`aws-resource` node in `core-services` mode. The node provides service tabs, typed operation controls,
local profile and region binding, generated previews, bounded pagination, progress, cancellation,
and the existing two-key destructive confirmation flow. Operations use the shared `spawn` and
`shell: false` path with no arbitrary shell or argv input. STS exposes caller identity only, never
temporary credentials.

Portable schema 3 keeps the core service, operation, region intent, and bounded safe input fields.
Profiles, endpoints, account sessions, request tokens, CLI paths, results, process state, and
credentials remain local. The feature article is
`docs/features/integrations/aws-core-services.md`, with the AWS index and site page updated too.

No tests, type checks, lint, builds, packaging, runtime interaction, reviews, accessibility or
security audits, or screenshots were run in this PR-preparation lane. The parent owns the next checks,
integration into the default branch, PR creation, issue comments and closure, and upstream PR #463.

## 2026-08-27, portable Comment and Activity attachments, issue #94

The implementation is on `feat/comment-attachments`, based on the reconciled `origin/main` tip
`0d22ff88`. `src/shared/comment-attachments.ts` defines bounded path-free attachment references,
drafts, failure results, byte-signature detection, and stable archive paths. The host implementation
in `src/core/board-attachments.ts` reads bounded sources, rejects symlink or reparse-point
ancestors, hashes and classifies bytes, writes collision-safe carriers atomically, and rechecks
integrity after restart. `src/core/board-log.ts` and `src/core/board-log-handlers.ts` append files
and comments transactionally, remove newly-created carriers when the log append fails, support
connected SSH projects through portable base64 decoding, and return a distinct failed-read result.

The Comments and Activity composer in `src/renderer/components/kanban/BoardLogPanel.tsx` now has a
semantic multi-file picker, drag/drop and clipboard-file routes, a removable queue with kind, size,
status and errors, safe local media previews, and posted-carrier integrity reads. The typed preload,
WebSocket bridge, relay surface, and IPC names carry the feature on Desktop, Server Edition, and
relay paths. Schema 3 now recognizes `comments/` and `assets/attachments/`, exports board history
and referenced carriers, validates their metadata before staging, and restores them below the new
project's `.nodeterm` directory.

Direct documentation is `docs/features/canvas/comment-attachments.md`, indexed from the Canvas
category. The roadmap and changelog record the same boundary. The generated `src/shared/docs-data.ts`
bundle was not regenerated because this lane explicitly forbids builds and checks. The parent
integration lane must regenerate it and verify that the bundled article matches the Markdown file.

This source lane intentionally did not run tests, lint, type checks, builds, packaging, runtime
interaction, reviews, security or accessibility audits, or captures. Focused archive round-trip,
failure rollback, remote decoding, Desktop and Server Edition interaction, and real capture proof
remain pending. The parent owns the dedicated pull request, append-only issue comments, integration,
issue closure, retention, and upstream PR #463.

## 2026-08-27, agent-to-agent drag collaboration, issue #90

The implementation is on `feat/agent-drag-collaboration`, based on the reconciled remote tip
`0d22ff8839a33b6cee9bb93ecc8070a18398c2f1`. `src/renderer/lib/agentCollaborationDrag.ts` defines a
bounded versioned drag payload, validates context-link capability through the existing agent
registry, and exposes the keyboard/touch pick event used by the Canvas. `TerminalNode.tsx` adds a
Material Design 3 collaboration handle, valid-target highlighting, and an accessible two-button
pick path. `Canvas.tsx` validates both nodes on the active project, then calls the existing
context-link `onConnect` path, so no process, account, credential, project, working-directory, or
conversation-transfer state is changed. `Link selected agents` is available from the node context
menu when exactly two compatible nodes are selected.

The source basis was checked against the pinned upstream checkout and `eneskirca/nodeterm` `main`
at `7d9cba33f7a29baa2a3cb010f07d351b87fc6e4d`. The existing upstream context-link behavior and the
namespaced bounded drag payload from commit `d1b7da3af28587716e7e4de2fb0db8cd18732c3f`, merged by
`acc5d51847094ea33c70721ea259e1483705a25e`, are the only reused semantics. Upstream does not
define conversation transfer or agent-spawn-on-agent-drop, so those behaviors remain intentionally
absent. Folder drops and ordinary node movement are unchanged.

Documentation is in `docs/features/agents/agent-drag-collaboration.md` and the Agents category
index. `CHANGELOG.md` and `ROADMAP.md` record the same scope and verification boundary. Tests, lint,
type checks, builds, packaging, runtime interaction, reviews, audits, and captures were not run by
this lane, as explicitly requested. The parent integration lane owns those checks, the dedicated
pull request, append-only issue comments, upstream PR #463, merge, and issue closure.

## 2026-08-27, context-window progress, issue #89

The implementation is on `feat/context-window-progress`, based on the reconciled remote tip `0d22ff88`.
`ContextMeter` now renders on every agent-backed node, session list row, Kanban card, and card modal,
including providers without telemetry. It shows exact used, total, remaining, and percentage values
only for finite provider readings, with explicit known, unknown, not-reported, stale, and unavailable
states. The meter has a visible Material Design 3 focus ring, accessible value text, a viewport-bounded
details surface, narrow-layout sizing, and reduced-motion behavior.

`ContextWindowUsage` carries provider and source scope plus a process source epoch and monotonic
generation. The renderer persists only bounded machine-local numeric snapshots and rejects older
generations within one epoch, so a fresh process generation 1 reading is accepted after restart.
Local and SSH source keys cannot overwrite one another. The remote first read now records the remote
file's absolute byte length, so a large transcript is not transferred again from byte zero on the
next poll. Codex rehydration honours `CODEX_HOME`; Gemini header reads are capped; concurrent locator
requests are coalesced; and the Server Edition registers the same mount-time rehydration route.

Documentation is in `docs/features/agents/context-window-progress.md`, indexed from the agents
category, and the offline bundle includes the new article. Full bundle regeneration remains pending:
`node scripts/build-docs-bundle.mjs` could not start because `esbuild` is absent in this clean
checkout, and this ultra-speed lane does not install dependencies or run builds. The parent integration
lane must regenerate and verify the bundle before merging. The current funny-level-10 lane remains
separate and unverified; this lane only routes its meter copy through the existing localization
boundary.

This source lane intentionally did not run tests, lint, type checks, builds, packaging, runtime
interaction, reviews, security or accessibility audits, or UI captures. The parent integration lane
must verify the exact commit and handle the dedicated pull request, issue progress and closure, and
any later evidence without treating these unrun checks as green.

## 2026-08-27, Cognition Devin CLI lane, issue #106

Issue #106 is implemented on `feat/devin-cli-support` from the measured upstream contract in
[`eneskirca/nodeterm#447`](https://github.com/eneskirca/nodeterm/issues/447). The source lane adds
the `devin` builtin registry entry and inline mark, argv prompt handling with the required `--`
separator, prompt-file and single-turn print command helpers, `-r` resume and `-c` continue forms,
and `devin` foreground-process recognition.

Devin's direct project hook format is implemented in `src/core/agents/hooks/devin.ts`. It preserves
foreign definitions while installing one managed observer command for `PreToolUse`, `PostToolUse`,
`PermissionRequest`, `UserPromptSubmit`, `Stop`, `PostCompaction`, `SessionStart`, and `SessionEnd`
in `.devin/hooks.v1.json`. The trusted local spawn path calls this installer for local Desktop and
Server Edition projects. SSH projects are deliberately left without this write because the current
remote protocol has no safe project-root file-write route.

`normalizeDevin` maps measured lifecycle events to the shared status model, while
`parseDevinTerminalNotification` treats BEL, OSC 9, and OSC 777 as a fallback only. A bare BEL is
unknown, and no terminal text is promoted into a fabricated structured event. Context and billing
usage, permission-mode mutation, title read/rename, subagents, transfer, branching, canvas control,
shared identity, and transcript rendering remain out of the capability lists until their Devin
contracts are measured.

The real Devin CLI was unavailable in this lane. No tests, lint, type checks, builds, packaging,
debugging, reviews, audits, runtime interaction, or screenshots were run. The docs bundle generator
was attempted but could not start because this isolated worktree has no `esbuild` installation;
the source Markdown article, indexes, changelog, roadmap, and this handoff are updated, while
`src/shared/docs-data.ts` still needs regeneration in an environment with the declared dependency.
The feature branch remains separate and is not integrated, pushed, or cleaned here.
## 2026-08-27, bounded wheel zoom and speed, issue #107

This implementation lane is `feat/wheel-zoom-speed` in the task-owned linked checkout. It ports
the behavior from upstream PR `eneskirca/nodeterm#451` at commit
`e98333c35fcb7846c1e9c86eb7a1b786f255587a`, while retaining the newer canvas gesture routing and
the current renderer architecture.

`src/renderer/canvas/wheel-zoom.ts` provides a shared ±50 `deltaY` budget per 40 ms burst,
point-of-use speed clamping from 0.2× through 2.0×, and bounded next-zoom calculation. The canvas
capture-phase handler owns one limiter per mounted canvas. Its speed multiplier is selected only
for plain-wheel input; Cmd/Ctrl+wheel and trackpad pinch use the fixed historical multiplier.
`Settings.wheelZoomSpeed` defaults to 1.0, so the historical feel remains intact, and the shared
settings persistence path supplies the value to Desktop and Server Edition.

`BehaviorSection.tsx` adds the guided slider with 0.2× minimum, 2.0× maximum, 0.1× steps, accessible
value text, live language-mode copy, funny-level variants, and a provenance line that distinguishes
loading, saved, compiled-default-equivalent, and scheduled states. The direct feature article is
`docs/features/canvas/wheel-zoom-speed.md`, linked from the Canvas category and expanded in
`docs/features/canvas/canvas-and-lifecycle.md`.

After the current-main merge, this feature consumes the shared funny-level 1–10 types, resolver,
and catalogue layers from issue #113. The wheel feature additions define no five-level type, range,
resolver, migration, or duplicate catalogue implementation; all ten-level behavior comes from the
shared implementation.

The root `CHANGELOG.md` and `ROADMAP.md` record the feature and its verification boundary. The
generated `src/shared/changelog-data.ts` and `src/shared/docs-data.ts` were not regenerated because
this checkout has no installed `esbuild`; the integration lane must run the normal generators and
commit their outputs before treating the offline viewer as current.

No tests, type checks, lint, builds, packaging, runtime interaction, reviews, security or
accessibility audits, or UI captures were run in this lane, per issue #107. The linked checkout is
 clean after the implementation commit. The feature branch was not integrated into `main`, no release
was created, and no cleanup was performed here.
## 2026-08-27, ten-level funny controls, issue #113

The implementation lane is `feat/funny-level-10`. It expands the shared funny-level union and
resolver to levels 1–10, adds distinct voice-only level 6–10 handling for legacy five-slot
catalogue rows, and keeps factual labels intentionally flat. New installations default both
language values to level 10. Settings schema version 2 is written by the settings store; valid
existing 1–5 values survive unchanged, while malformed or missing hand-edited values resolve to
the level-10 shipped default. Renderer hydration and scheduled settings use the same bounded
normalization.

The Language settings controls now expose 1–10 with a level-10 label and saved-base versus
scheduled-value provenance. The Easter-egg and portal-entry resolvers consume the full range.
The site uses versioned `nodeterm-playground.v2` storage, reads the v1 key once for migration,
preserves valid old values, defaults invalid values to 10, and exports the range/schema metadata.
Related docs, site article copy, roadmap, and changelog are updated.

No tests, type checks, lint, builds, packaging, reviews, audits, runtime interaction, or captures
were run in this source lane, per issue #113. The parent integration lane must verify the complete
tree against its exact integrated commit. No merge, release, issue comment, issue closure, or
cleanup was performed here.
## 2026-08-27, desktop trackpad gesture facts, issue #108

The implementation is on `feat/trackpad-gesture-facts`, based on the current `origin/main` tip
`00127bc0` and grounded in upstream PR `eneskirca/nodeterm#452`, commit
`391056b81abd0b933757fa6a4aee23d84cb48884`. `src/main/trackpad-gesture.ts` reduces native macOS
scroll and pinch begin/end input facts into depth-safe active-state edges and ignores unmatched end
events. The main window sends those edges through `IPC.canvasTrackpadGesture`, the typed preload
member `onCanvasTrackpadGesture`, and the browser stub's documented no-op.

`MacWheelGestureRouter` now accepts desktop-only gesture reporting. An open gesture or a close less
than 500 ms ago routes precise-pixel wheel packets to canvas panning. Reported silence routes them
to wheel zoom, while the Server Edition keeps the existing renderer heuristic because its browser
surface lacks the native input stream. Settings, the canvas article, canvas category index,
`CHANGELOG.md`, and `ROADMAP.md` record the same behavior and boundary. Mobile has no mouse-wheel
canvas route and is explicitly not applicable.

The generated `src/shared/docs-data.ts` bundle was not regenerated because this lane's explicit
boundary forbids builds; the parent integration lane must regenerate and verify it before merging
the documentation update.

This source lane intentionally did not run tests, lint, type checks, builds, packaging, runtime
interaction, reviews, security or accessibility audits, or UI captures. The parent integration
lane must verify the exact commit and handle the dedicated pull request, issue progress and closure,
upstream PR #463, and any later evidence without treating this lane's unrun checks as green.

## 2026-08-27, Nextcloud AIO hosting implementation, issue #52

The implementation lane is `feat/program-41-nextcloud-aio`, based on `12055e96` before the
current-main integration. The canvas catalog creates a `nextcloud-aio` service node from
`nextcloud-hosting`, with a typed shared contract in `src/shared/nextcloud-aio.ts`, a desktop
manager in `src/main/remote/nextcloud-aio-manager.ts`, and a guided renderer surface in
`src/renderer/components/nextcloud/NextcloudAioPanel.tsx`.

The profile pins `nextcloud/all-in-one:2025.8.0` from the official source, discloses that its
read-only Docker socket mount can control the Docker host, refuses `--privileged`, uses dropped
capabilities and `no-new-privileges`, and sends fixed argument arrays only. It exposes discovered
context selection, loopback/private binding, bounded port validation, health, lifecycle, update,
backup, restore, rollback, cancellation, partial progress, and explicit failure recovery. Every
search field has its own adjacent anchored regex builder.

Schema 3 carries only `nextcloudAioConfig` safe intent. Context names, endpoints, socket paths,
container ids, volume contents, backup records, process state, host paths, and credentials remain
local and import has no external side effect. Direct documentation is in
`docs/features/integrations/nextcloud-aio-hosting.md`, the category index, the offline docs bundle,
and `site/docs/nextcloud-aio-hosting.html`.

No tests, type checks, lint, reviews, security or accessibility checks, builds, packaging,
installer execution, runtime interaction, or captures were run in this ultra-speed lane. The source
is committed for the parent integration lane to verify against the exact integrated commit.

## 2026-08-27, Usage popover default account selection, issue #70

The implementation lane is `feat/program-59-usage-default-account`, based on the exact default branch tip `54164b84dce0b7e62787b1de2885405ff4ed821c`. Implementation commit `95e8eb8e19e4a568bf7286b35a9cdf789a6983ac` and documentation commit `1665f63d96d9d95e2f1d11cde9aa04763ddff997` are present on the feature branch.

The usage popover in `src/renderer/components/UsageIndicator.tsx` now exposes local and SSH Claude identity rows as independently selectable radio actions labelled `Use for new sessions`. The selection changes only the active project's default account, preserves the account identity of existing nodes and running sessions, treats stale saved identities as System, and keeps rows from other hosts read-only. Arrow keys, Home, End, Escape focus return, accessible names, and pressed state are included. The existing provider identity rendering, duplicate-row reduction, and system-account switch action remain present. `src/renderer/styles.css` contains the selection and focus treatment.

Direct documentation is `docs/features/integrations/usage-popover-default-account.md`, indexed from the integrations category. The changelog and roadmap carry the same scope and verification boundary.

This source lane intentionally did not run tests, lint, type checks, builds, packaging, runtime interaction, reviews, accessibility checks, security audits, or UI captures. The parent integration lane owns those checks, generated documentation bundles, the dedicated pull request, issue progress and closure, main integration, and release work.

### Handoff facts

- Base: `origin/main` at `54164b84dce0b7e62787b1de2885405ff4ed821c`.
- Tip: `1665f63d96d9d95e2f1d11cde9aa04763ddff997`, verified equal to `refs/heads/feat/program-59-usage-default-account` on origin. The implementation commit remains `95e8eb8e19e4a568bf7286b35a9cdf789a6983ac`.
- Working tree: clean after the commit.
- No merge into main, release, deletion, or cleanup was performed.
## 2026-08-27, managed Codex account behavior, issue #86

The account behavior lane is implemented on `feat/program-75-account-behavior` at
`e91c4ee610307302fb427efc1b12f75b65e7d254`. It removes duplicated account lifecycle registration,
app-server readers, and rollout-link publication paths from the current base while preserving the
shared safe account-id predicate, isolated account homes, owner-bound switch reservations,
no-overwrite same-machine rollout hardlinks, rollback, and removal coordination.

The lane was compared with `origin/main` at
`54164b84dce0b7e62787b1de2885405ff4ed821c`. That ref was 108 commits ahead and would introduce
unrelated changes across 284 files, so no unrelated base merge was retained in this account-only
lane. The working tree remains clean after the account commit and the normal push.

Direct records are in `docs/features/agents/codex-account-behavior.md` and the agents category
index. Migration, endpoint modeling, cross-project transport, projections, navigation, grouping,
dependency operations, custom-agent harnesses, model switching, and restart logic remain outside
this handoff.

Tests, lint, type checks, builds, packaging, runtime interaction, reviews, audits, and screenshots were
not run by explicit lane scope. No main merge, release, deletion, or cleanup was performed.

## 2026-08-27, bundled AWS CLI v2 lane, issue #41

Issue #41 is implemented on `feat/program-30-bundled-aws-cli`, reconciled with
`origin/main` at `12055e96d66c7e4cfdb143295b78ed20d68fd97e`, and pushed at
`d60a25fa0f8d4665cc3e898c531cb4440ea72d9b` plus the reconciliation commit recorded below.
The lane keeps AWS CLI v2 `2.36.32` in the immutable dependency manifest and stages the official
Windows x64 MSI through `scripts/ensure-aws-cli-resources.mjs`. The resource path checks the
download size, rejects redirects, verifies SHA-256, and uses a unique staged file before packaging.

The host-owned dependency service checks the packaged resource first, then a verified local cache,
then the canonical HTTPS source. It extracts the MSI through `msiexec.exe /a` into application-local
storage, records archive provenance, requires the pinned `aws-cli/2.36.32` version prefix, and
returns parsed version details. The `nodeDependencyDetails` IPC route also inventories the installed
`awscli/botocore/data` tree by service and model version, with bounded service and file traversal
and an incomplete state for missing, empty, or truncated model data. Desktop preload, renderer
stubs, and Server Edition WebSocket bridges expose the same typed route.

Direct fetch evidence: the official URL returned HTTP 200, a 49,405,952-byte MSI, and SHA-256
`bc695531b7fd83490e02741777dfda109cfab7fd9bef85fa1d5db21684cbaee2`, matching
`dependencies.manifest.json`.

Direct documentation is in `docs/features/dependencies/aws-cli-v2.md`, indexed from the dependency
category. `src/shared/docs-data.ts` contains both the category link and bundled article. The roadmap
item remains unticked because the full implementation lane has no test, build, package, installer,
runtime, or UI evidence yet. A bundled-doc generator invocation was attempted but could not start
because this isolated checkout has no `esbuild` installation; the generated entries were reconciled
manually and matched the checked-in Markdown bodies.

The reconciliation commit merged `origin/main` non-destructively and kept main's current package
version, engine range, scripts, package dependencies, and unsigned Squirrel settings. `package.json`
contains exactly one AWS preparation script and one AWS packaged-resource entry. `package-lock.json`,
the dependency manifest, installer, IPC, bridge, and shared-type changes from main are retained.

No tests, type checks, lint, reviews, security or accessibility checks, builds, packaging, installer
execution, runtime interaction, or screenshots were run, per the issue's explicit ultra-speed boundary.
The feature branch was not integrated into main and no cleanup was performed in this lane.

## 2026-08-27, AWS CLI model documentation index

Issue #42 is implemented on `feat/program-31-aws-model-docs`. The platform-free
`src/core/aws-model-documentation.ts` module consumes bounded decoded official AWS CLI service,
paginator, and waiter models and projects them into deterministic service, command, option,
paginator, waiter, input, output, and input-skeleton documentation records. It generates official
`docs.aws.amazon.com` CLI reference links, accepts only allowlisted optional API reference URLs,
flattens documentation text, rejects malformed source records, duplicate required members, missing
required shape members, duplicate CLI service tokens, and opaque future shape kinds that cannot be
represented safely.

The module also provides local plain-text or explicit regular-expression search, guided service,
command, and section picker models with exact disabled-state reasons, and a strict portable
selection projection. Only `serviceId`, `commandName`, and the selected documentation section can
enter schema 3 intent. Installed executable paths, decoded model caches, generated runtime indexes,
credentials, profiles, provider sessions, account or role identity, endpoints, pagination cursors,
waiter progress, results, and process state are explicitly omitted.

The article is bundled in `src/shared/docs-data.ts` for the offline documentation browser. The AWS
service catalog row remains planned for the later executor and typed-wizard lanes, but links to the
implemented documentation-index article rather than only the program plan.

This lane intentionally did not run tests, type checks, lint, reviews, security checks, accessibility
checks, builds, packaging, installer execution, runtime interaction, or UI captures. No runtime,
accessibility, packaged-artifact, or visual correctness verdict is claimed. The later AWS CLI
inventory lane must supply decoded official models, and the later wizard lane must render the picker
and shape records as typed controls without adding a blank command textbox.

## 2026-08-27, AWS Universe portal with unlimited instances

Issue #39 is implemented on `feat/program-28-aws-universe`. The renderer now exposes an AWS Universe
navigator with local plain-text search and an adjacent anchored full regex builder, guided naming,
keyboard-operable instance selection, and explicit AWS-only scope. Root portal cards open their
matching child canvas through a real event route. Each child starts with one permanent scope-bound
Shop node.

Portable project files preserve safe AWS child-canvas intent, node membership, viewport, and
canvas-owned relationships. Schema 3 projection and hydration keep credentials, profiles, SSO and
role sessions, CLI paths, local files, process state, caches, and account bindings out of shared
content. Import remains data-only and validates relationship ownership before accepting the result.

Changed implementation paths include `src/shared/aws-universes.ts`, `src/shared/types.ts`,
`src/shared/node-catalog.ts`, `src/shared/i18n/catalog.ts`, `src/core/workspace-files.ts`,
`src/core/portable-canvas-projection.ts`, `src/renderer/state/projects.ts`,
`src/renderer/components/AwsUniverseNavigator.tsx`, `src/renderer/nodes/AwsUniversePortalNode.tsx`,
`src/renderer/canvas/Canvas.tsx`, and `src/renderer/styles.md3.css`. Related README, roadmap,
changelog, offline documentation, and site documentation accompany the implementation.

This lane intentionally did not run tests, type checks, lint, reviews, security checks,
accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures.
Those checks remain unverified and are delegated to a later integration lane.

## 2026-08-27, Cloudflare core managers source implementation, issue #57

This lane is `feat/program-46-cloudflare-core-managers` in the task-owned linked worktree at
`C:/Users/cntow/Documents/GitHub/material-nodeterm-worktrees/issue-57`. It adds the typed Cloudflare
account, zone, DNS, SSL/TLS, ruleset, redirect, cache, and analytics contract in
`src/shared/cloudflare-core-managers.ts`, the host service and shared IPC registration in
`src/core/cloudflare-core-managers.ts`, and Desktop and Server Edition bridge wiring. The canvas node
is `src/renderer/nodes/CloudflareCoreManagersNode.tsx`; safe operation intent is persisted through
`src/renderer/state/workspace.ts` and `src/core/portable-canvas-projection.ts`, while local sealed
credentials and bindings remain under the application data directory.

The manager uses a fixed HTTPS API base, typed allowlisted paths and fields, bounded request inputs,
4 MiB response handling, 500-row output, 90-second cancellation, safe previews, destructive-action
classification, and explicit unavailable states. Credential values never cross IPC or enter portable
data. The account, zone, DNS, SSL/TLS, ruleset, redirect, cache, and analytics result lists each have
an isolated search field with its own adjacent anchored full regex builder. No raw request editor or
arbitrary shell path is provided.

The direct feature article is `docs/features/integrations/cloudflare-core-managers.md`, with its
category index, roadmap, and changelog entries updated. No tests, type checks, lint, reviews, security
or accessibility checks, builds, packaging, installer execution, runtime interaction, or UI captures
were run in this ultra-speed lane. The owning integration lane must verify the exact integrated
commit and regenerate the offline documentation bundle after review.
## 2026-08-27, Browser Portal record refresh, issue #63

The Browser Portal records were refreshed after fetching and inspecting the exact `origin/main`
tip `54164b84dce0b7e62787b1de2885405ff4ed821c`. The feature article, site article, and offline
article now state the no-profile-borrowing boundary, exact canvas/modal guest ownership, bounded
navigation states, safe close/restart/crash recovery, and the Server Edition and mobile limitations.
The roadmap remains unticked because built-artifact evidence is still pending.

This pass did not merge the diverged 128-commit `origin/main` history into the feature branch and did
not rewrite the existing Browser Portal commit. No tests, lint, type checks, builds, packaging,
runtime interaction, reviews, audits, or screenshots were run.

## 2026-08-27, Browser Portal implementation, issue #63

The Browser Portal lane is implemented on `feat/program-52-browser-portal`. The browser profile
picker now validates guided names, rejects duplicates, offers a destructive-confirmed local reset,
and distinguishes removing a project label from clearing local session data. Browser guests carry an
explicit canvas or modal surface identity, and the agent-opened route now creates its node with the
validated per-project partition instead of accidentally treating that partition as the owner id.
Temporary popup and final-tab lifecycle behavior remains explicit, while the keep-alive ghost mounts
only its one hidden surface.

Schema 3 now carries the selected `browserProfileId` as safe project intent while retaining cookies,
local storage, cache, extension paths, process state, and debugger handles on the machine. The new
categorized article, offline bundle entry, documentation page, and browser category index document
the portability and unsupported Server Edition/mobile boundaries.

Verification boundary: this ultra-speed implementation lane intentionally ran no tests, type checks,
lint, reviews, security or accessibility checks, builds, packaging, installer execution, runtime
interaction, or captures. The documentation bundle generator was attempted but could not run because
the checkout has no `esbuild` package installed; the offline entry was updated manually and must be
regenerated by the verification lane before release.

## 2026-08-27, Express File Converter completion, issue #21

The implementation lane is `feat/program-10-file-converter`, refreshed by fast-forward before edits
to `origin/main` at `7c14db981f9e130cda2b9100285805f9646d7e58`. The later base already contained the
per-category, plain-text-first searches and adjacent anchored regex builders, so this lane did not
duplicate them.

`src/core/converter/service.ts` now reserves the first unused `name.ext`, `name (2).ext`, and later
destination across both the filesystem and every live queue item. It repeats the reservation check
after the asynchronous filesystem probe, records a suffix index for visible disclosure, rebuilds
reservations when terminal rows are removed, and retains the existing final atomic no-clobber
publication and explicit race-time overwrite path. `src/shared/converter.ts` carries the optional
suffix index. `FileConverterPanel.tsx` explains adjusted names and gives every completed row an
active-session **Open in Visual Studio Code** action while retaining desktop **Reveal**.

The converter remains a global, machine-local tool rather than a canvas node. Schema 3 projects omit
its source and destination paths, progress, process state, editor actions, and queue data. Project
import therefore causes no converter detection, conversion, folder creation, or process launch.

Verification boundary: the ultra-speed lane intentionally ran no tests, lint, type checks, builds,
packaging, installer execution, reviews, security or accessibility audits, runtime interaction, or
captures. The parent integration lane must record any later build, package, release, or runtime
evidence without treating it as evidence for checks that did not run here.

## 2026-08-27, Docker host manager implementation

Issue #19 is implemented on `feat/program-08-docker-host-manager`. The Docker host service node now
opens a real guided manager instead of the former saved-address placeholder. It discovers Docker CLI
contexts and classifies local and SSH contexts without exposing endpoints to the renderer. Separate
resource tabs cover containers, images, volumes, networks, Compose projects, statistics, bounded
redacted logs, and fixed typed container tasks. Every resource list has plain-text search and an
adjacent anchored regex builder.

The shared action union contains no shell or arbitrary argument shape. The main process revalidates
contexts, resource identifiers, names, image choices, and typed tasks before invoking `docker` with
argument arrays. Guided container creation uses an allowlisted image, generated ownership label,
resource limits, dropped capabilities, `no-new-privileges`, read-only root by default, bounded tmpfs,
and no network by default. Destructive removal uses the application's two-key confirmation flow.
Long operations emit queued, running, completed, failed, and cancelled progress.

The Node Catalog records a schema 3 safe blueprint with only neutral image, network, read-only, and
resource-bound intent. Context endpoints, SSH identity, credentials, Compose paths, live resource
ids, statistics, logs, job ids, and process state remain machine-local. Importing that intent has no
Docker side effect. Server Edition returns an explicit unsupported result for this desktop-owned
capability.

Directly related documentation is current in `docs/features/remote/docker-host.md`, its category
index, the offline documentation article, and `site/docs/docker-host-manager.html`. `CHANGELOG.md`
and `ROADMAP.md` record the same verification boundary.

No tests, type checks, lint, reviews, security or accessibility checks, builds, packaging, installer
execution, runtime interaction, or captures were run in this ultra-speed lane. The owning integration
lane must treat every such verdict as unverified.

## 2026-08-27, door-only universe navigation policy

Issue #37 now has a platform-free paired-door policy in
`src/core/universe-door-navigation.ts`. It validates reciprocal entry and return doors, requires
known distinct canvases, returns the exact matching exit-door id after a permitted activation, and
refuses tab, palette, history, or direct canvas selection. `src/core/portable-canvas-projection.ts`
accepts and validates the safe door records in schema 3. The transferable fields contain no
credentials, local paths, provider sessions, process state, host identifiers, caches, or navigation
history.

The visual door construction and Multiverse child-canvas lanes are still pending, so their shells
must call `decideUniverseDoorNavigation` before switching the active universe canvas and must not
expose child canvases as ordinary tabs. Direct documentation is in
`docs/features/canvas/door-only-universe-navigation.md` and the canvas category index links it.

No tests, type checks, lint, reviews, security or accessibility checks, builds, packaging,
installer execution, runtime interaction, or UI captures were run in this ultra-speed lane.

## 2026-08-27, Home Assistant multi-instance client

Issue #26 adds the shared Home Assistant contract in `src/shared/home-assistant.ts`, the host-owned
client in `src/core/home-assistant/`, desktop and Server Edition registration, preload and
WebSocket bridge methods, and the guided node surface in
`src/renderer/components/home-assistant/HomeAssistantPanel.tsx`. The existing Home Assistant
service node now renders that client instead of an address-only placeholder.

Instance metadata is stored below application data in `home-assistant/instances.json`. Access
tokens use a dedicated Home Assistant credential directory through the core platform's existing
seal and unseal seam, and are never returned over IPC.
The selected instance address remains in the machine-local `serviceConnection` overlay. Schema 3
stores only `homeAssistantIntent`, containing the REST or WebSocket preference and domain filter,
plus the existing node label, layout, and relationships. Import performs no network request and
does not restore a credential, instance id, address, socket, entity result, or cache.

The interface supplies searchable instance, domain, and entity surfaces, each with its own adjacent
anchored regex builder. REST and WebSocket discovery enforce a 20-second deadline, a 5 MB response
bound, and a 20,000-entity cap. Progress, cancellation, retry, partial-result wording, exact
disabled-state reasons, and two-key destructive instance removal are present. Program 16 and
Program 17 remain responsible for domain control nodes and dedicated sensor display nodes.

No tests, type checks, lint, builds, packaging, reviews, security checks, accessibility checks,
installer execution, runtime interaction checks, or UI captures were run in this ultra-speed
implementation lane. The source is implemented but has no runtime or packaged verification from
this lane.

## 2026-08-27, Home Assistant sensor display source implementation

Issue #28 is implemented on `feat/program-17-home-assistant-sensors`. The lane adds the
`homeassistant-sensor` node kind and Node Catalog entry, shared portable configuration and typed
API contracts, a host-owned desktop and Server Edition service, machine-local secret-sealed
binding, bounded entity discovery and observation history, relay refusal, renderer bridge wiring,
and a Material Design 3 canvas surface.

Portable project state stores selected entity ids, display modes, reviewed gauge ranges, selected
attribute keys, refresh timing, history limits, and normal node layout. Instance URLs, credentials,
provider sessions, local paths, host identity, fetched values, cache, and runtime state stay in
`<app-data>/home-assistant-sensor-nodes/`. The machine-local record keeps the last successful selected
entities, so a temporary outage can show an explicitly stale observation without claiming a live
response. Importing a node has no network, deployment, process, or
download side effect and opens unbound with explicit Configure, Rebind, Adopt, Deploy, Locate
Asset, and Leave Unbound routes.

The display supports ordinary values, binary states, enum options, numeric gauges, bounded local
trends, event entities, weather entities, calendar entities, and selected attributes. Entity and
display-mode searches use plain text by default and carry adjacent anchored full regex builders.
Information, partial results, progress state, and failures remain non-blocking, with the shared
notification history receiving outcomes. Leaving a local binding uses the existing two-key
destructive confirmation.

Documentation is in
`docs/features/integrations/home-assistant-sensor-display.md`, indexed from the integrations
category, mirrored on the documentation site, and represented in the offline documentation bundle.

This ultra-speed implementation lane intentionally did not run tests, type checks, lint, reviews,
security checks, accessibility checks, builds, packaging, installer execution, runtime interaction,
or UI captures. The next integration owner must run the appropriate verification and obtain real
built-artifact evidence before changing any roadmap or release claim to verified.

## 2026-08-27, advanced file pipelines

Issue #22 source implementation is on `feat/program-11-advanced-pipelines`. The existing converter
catalog and persistent queue now expose packaged PDF inspection, text extraction, split-to-ZIP,
merge-from-ZIP, first-page extraction, reverse ordering, all-page clockwise rotation, metadata
removal, supported Sharp image conversions, local English OCR, bounded ZIP entry
inventory, deterministic JSON key ordering, and the existing structured-data mesh. Audio, video,
TAR, 7-Zip, DOCX, HEIC, and ICO remain visible with honest unavailable reasons when no stable
packaged adapter exists.

`src/core/converter/advanced-pipeline.ts` owns the 40-million-pixel image bound, 500-page PDF bound,
2,048-entry and 512 MiB declared-expanded ZIP bounds, packaged OCR language path, output reopening,
and no-extraction ZIP inventory. `src/shared/converter.ts` carries safe portable pipeline intent with
explicit Configure, Rebind, Adopt, Deploy, Locate Asset, and Leave Unbound actions. It excludes
paths, credentials, provider sessions, process and host identity, machine identifiers, caches, and
generated output. Import is descriptive and side-effect free.

The renderer reuses the existing Material Design 3 converter drawer, file/folder pickers,
plain-text-first category searches with adjacent anchored regex builders, lossy acknowledgement,
destination preflight, bounded queue progress, pause, cancel, retry, partial outcomes, atomic output,
and notification path. It now explains portable intent before queueing.

Documentation is in `docs/features/converter/advanced-pipelines.md`, the offline bundle, and
`site/docs/advanced-file-pipelines.html`. The roadmap remains unticked. Under the explicit
ultra-speed boundary, no tests, type checks, lint, builds, packaging, installer execution, runtime
interaction, reviews, security or accessibility audits, or UI captures were run. Those verdicts and
the packaged adapter presence remain unverified.

## 2026-08-27, scoped Multiverse child canvases and hierarchy

Issue #33 is implemented on `feat/program-22-multiverse-canvases`. Projects now persist a bounded
hierarchy of Multiverse child canvases through `Project.multiverseCanvases`, while
`Project.activeCanvasId` remains runtime-only navigation state. Each child owns its viewport, nodes,
bridges, ropes, parent, order, and exact depth. Creation uses the shared deterministic
special-universe coordinator, so each child begins with one scoped Shop and the root remains without
one.

The canvas app bar now exposes a Material Design 3 hierarchy control. Its canvas list and guided
parent picker each have isolated plain-text-first search and an adjacent anchored regex builder.
Depth-8 parents remain visible with an exact disabled reason. Switching canvases commits the outgoing
view, reloads the selected scope, and guards against a delayed commit writing the prior canvas over
the new one.

Workspace files and portable schema 3 preserve the hierarchy, scoped nodes, and canvas-owned
relationships. Import validates bounded counts, identifiers, titles, parent-before-child ordering,
exact depth, node arrays, and viewports. Machine-local terminal execution settings remain outside
the shared file, and importing performs no process launch, download, network request, or provider
operation.

Changed implementation paths include `src/shared/types.ts`, `src/shared/multiverse-canvases.ts`,
`src/core/workspace-files.ts`, `src/core/portable-canvas-projection.ts`,
`src/renderer/state/projects.ts`, `src/renderer/components/MultiverseNavigator.tsx`,
`src/renderer/canvas/Canvas.tsx`, and `src/renderer/styles.md3.css`. Directly related README,
feature documentation, offline documentation, site documentation, roadmap, changelog, and handoff
records accompany the implementation.

This lane intentionally did not run tests, type checks, lint, builds, packaging, installer
execution, reviews, audits, runtime interaction, accessibility checks, security checks, or captures.
The owning integration lane must preserve that honest unverified state and run only the checks its
own scope authorizes.

## 2026-08-27, top-down recovery game

Issue #36 implementation is on `feat/program-25-recovery-game` at source checkpoint
`190fcff016a8acdbfc70c583d61c6bdda287bd81`, with the follow-up source changes in the current
working directory. The lane adds a portable recovery-game node with three energy keys, hazards that
return the player to the start while preserving energized keys, and an activation core that requires
all keys plus the player's position. Arrow keys, `W`/`A`/`S`/`D`, adjacent board buttons, status
announcements, reset, explicit disabled-state reasons, and a local board search with an anchored
regex builder are included.

The recovery snapshot is normalized at live-state and schema 3 portable-projection boundaries.
Only bounded board intent is retained: coordinates, key ids, activation state, and hazard-contact
count. Credentials, paths, processes, host identifiers, caches, and external side effects are not
part of the projection. The feature article is `docs/features/canvas/recovery-game.md`, indexed by
`docs/features/canvas/README.md`; `ROADMAP.md` and `CHANGELOG.md` record the source-only state.

The lane did not run tests, type checks, lint, builds, packaging, installer execution, runtime
interaction, reviews, security or accessibility checks, or UI captures. The integration owner must
regenerate and verify the offline documentation bundle after the new article, then run the required
checks against the built Windows desktop application before calling the issue verified.

## 2026-08-26, desktop Material Design 3 and personal vocabulary reconciliation

This source-only lane is on feat/full-app-material3-reconciliation at the current integration tip.
It adds a hand-written rendered-surface inventory in docs/features/appearance/material-3-audit.md
and scripts/check-material-audit.mjs, expanded with onboarding, the floating action menu, password
manager, converter adapter catalog, Minecraft backups/players/properties, dim sum surprise, publish
dialog, find bar, remote picker, and browser profile picker. The inventory has 212 explicit rows
across shell, nodes, destinations, settings, overlays, status, state, and site categories. It uses
exact selector boundaries and radius-owner checks rather than corpus-wide substring evidence.

Shared NumberField, Radio, Progress, and Tabs primitives were added, native radio groups received
stable names, Tooltip now supports keyboard focus, child association, viewport clamping and
above-anchor placement, Dialog now labels its title, traps focus, and makes the background inert
while open, and compact controls use shared token geometry. The vendored Outfit and Roboto Mono
stacks remain the source of the global Material Design 3 font aliases.

Personal vocabulary coverage is recorded in a separate hand-written inventory with 34 mapped
producer rows plus 34 explicitly classified production surfaces. The newly classified surfaces
include onboarding, the dim sum notice, publish/find/remote picker surfaces, browser profiles,
password management, conversion, Minecraft panels, authenticator and speech settings, toy-lock
setup, history, docs, appearance, regex, status, update, resume, and node surfaces. The validated
upload/cache mapper remains the only replacement path; commands, URLs, paths, identifiers, code,
external records, provider values, filenames, hashes, and user-supplied values stay byte-exact.
Thirty-one production surfaces remain open for direct call-site mapping, and the coverage check
is therefore intentionally red.

Verification run in this lane:

- node scripts/check-material-audit.mjs passed with 1762 base assertions and 2006 assertions
  including the unique-inventory-row pass, required-row, source-marker, exact style-owner,
  localized-string, documentation-row, and mapper-call negative regressions.
- node scripts/check-personal-vocabulary-coverage.mjs ran 183 assertions, including
  removed-producer, removed-mapper, removed-documentation-row, and real-file mutations, and is red
  because 31 listed production surfaces still need direct mapper call-site coverage.
- node --check passed for both audit scripts.
- No general tests, type checks, builds, packaging, runtime launches, or captures were run, by the
  source-only lane boundary. Current-main preservation remains required during integration, with
  p79 WSL, p80 picker, p82 clipping, dependency foundation, and the current docs bundle kept intact.

## 2026-08-26, desktop layout safety sweep

Implemented a source-driven clipping repair for the Windows desktop renderer on
`fix/desktop-clipping-sweep` at `3b7a846902bd762cf50a61c36a795af3a0f032ba`. `ContextMenu` now
automatically bounds every root dynamic menu, including roots that contain submenus. Open flyouts
are portaled to `document.body` and positioned from their trigger, so root scrolling cannot clip
the child surface. The anchored popover geometry no longer enforces a 120px height when the anchor
has less space, so it uses the actual available viewport space and scrolls its inner content. A new
`src/renderer/styles.clipping.css` layer bounds menus, flyouts, dialogs, settings, onboarding,
command palette, and documentation content, and wraps long localized or user-renamed values.
Narrow settings rows stack, focus remains visible, and reduced-motion transitions are disabled.
`src/renderer/components/ContextMenu.viewport.test.tsx` adds source coverage for a long root menu
with a submenu and a taller-than-viewport anchored surface. Root and flyout overflow are separated
so the WSL lane can add fixed title and action regions without a later global `.mdx-dialog` rule
overriding them. Those tests were added but not run in this lane.

This lane updated `docs/features/appearance/desktop-clipping-inventory.md`, the appearance index,
`CHANGELOG.md`, and `ROADMAP.md`. It did not edit the WSL creator, worktree picker, Source Control,
or landing page surfaces. It did not run tests, type checks, builds, packaging, captures, reviews,
or audits, per the lane boundary. Parent integration must independently run the cheap headless
route against the built Windows artifact at narrow and high-scale tuples, then resolve any overlap
with the WSL creator, worktree picker, comment attachments, or Material Design 3 audit lanes.

## 2026-08-26, WSL creator repair

The WSL instance creator lane added operation-scoped progress and cancellation across the shared
types, IPC channels, Electron preload, Server Edition WebSocket bridge, core WSL service, and the
renderer dialog. Creation now emits validation, checking, installing, recording, completed,
failed, and cancelled states with bounded four-step phase progress and elapsed time. The
installation phase is explicitly indeterminate because `wsl.exe` provides no byte or percentage
telemetry. A per-operation AbortController prevents duplicate submissions and aborts the active
`wsl.exe` child process on cancel. The renderer now
uses the shared Material Design 3 dialog and outlined text field primitives, a searchable
distribution listbox, an accessible phase progress bar with an indeterminate installation phase
and explicit aria-valuetext, UUID v4 operation-id validation,
reduced-motion handling, disabled
submit state, and inline recovery copy. WSL remains separate from the Linux ISO VM surface.

Changed files: `src/shared/ipc.ts`, `src/shared/wsl.ts`, `src/core/wsl/runtime.ts`,
`src/core/wsl/create.ts`, `src/core/wsl/service.ts`, `src/preload/index.ts`,
`src/renderer/bridge/ws-bridge.ts`, `src/renderer/wsl/wslCoreApi.ts`,
`src/renderer/wsl/WslCreateDialog.tsx`, `src/renderer/canvas/Canvas.tsx`,
`src/renderer/styles.md3.css`, `docs/features/wsl/wsl-instances.md`, `CHANGELOG.md`,
`ROADMAP.md`, and this file.

This implementation lane intentionally did not run tests, type checks, lint, builds, packaging,
reviews, audits, installer execution, runtime interaction, or captures. The owning coordinator
must independently review the diff, run focused verification in a quiet checkout, exercise the
real packaged flow, and post the exact result on issue #92 before integration.

## 2026-08-26, existing-worktree picker viewport repair

Repaired the existing-worktree section in `src/renderer/components/WorktreeDialog.tsx` and its
styles in `src/renderer/styles.css` and `src/renderer/styles.md3.css`. The picker now marks the
long adoption collection as an accessible counted list inside a dedicated scroll region. The
dialog has a scoped opaque Material surface with overflow containment, while the title, repository
context, branch/path controls, and actions remain outside the scrolling list. Rows keep visible
focus, Material Design 3 token styling, adequate targets, full branch/path values that wrap rather
than ellipsize, and responsive sizing at narrow widths. Normal layouts scroll only the collection;
an exceptionally short viewport gets a bounded card-scroll fallback so fixed controls remain
reachable.
The picker now filters visible branch and path text with a plain-text-first search and an adjacent
anchored full regex builder, retaining synchronized pattern, flags, validation, and mode state.
The WSL creator and other dialogs are not changed.

The exact cause was an unbounded direct row list inside a flex dialog. The shell's `max-height`
alone did not make that child shrink, so rows continued painting beyond the card and viewport.
The new flex constraints and `.bind-existing__list` overflow region keep the rows inside the
dialog surface.

This lane did not run tests, type checking, linting, builds, packaging, installer execution,
runtime interaction, captures, reviews, or audits, and made no commit or push. Integration must
independently inspect the final diff and verify the built desktop picker with a long list, narrow
widths, high display scales, keyboard traversal, and screen-reader list count/state before this
roadmap item can be ticked.

## 2026-08-26, automatic node dependency foundation

Implemented the shared node-feature dependency foundation in `src/shared/node-dependencies.ts` and
`src/core/node-dependencies/`. The typed manifest captures id, version, platform, architecture,
canonical HTTPS source, SHA-256, bundled-source slot, archive format, expected files, unpacked size,
license/redistribution state, install mode, health probe, and repair strategy. The lifecycle service
uses a machine-local app-data cache and install root, canonical-origin HTTPS redirects, bounded
bytes/time, digest verification before extraction, safe ZIP traversal checks, unique staging, atomic
publication with rollback, absolute-path health probes, cancellation, repair, and restart
reconciliation. It never treats PATH as readiness and never accepts renderer-provided URLs or shell
commands.

Typed channels are registered on both Electron and Server Edition CorePlatform hosts, with preload
and authenticated WebSocket bridge APIs carrying catalog, exact disabled reasons, progress, state,
repair, cancellation, and resume metadata. The Node Catalog itself is intentionally not implemented
in this lane. Added the categorized dependency article and index, updated the public program plan,
ROADMAP, and CHANGELOG. `src/shared/docs-data.ts` was deliberately not regenerated per lane scope,
so the offline bundle remains an explicit integration point.

This lane did not run tests, type checking, lint, security checks, builds, packaging, installer
execution, runtime interaction, or captures, and made no commit or push. Remaining integration work
includes focused lifecycle/IPC verification, generated offline docs refresh, catalog
`Install and continue` wiring, and packaged-bundle proof for any future bundled dependency.
## 2026-08-26, Material Design 3 surface audit

The Windows desktop Material Design 3 audit is recorded in
`docs/features/appearance/material-3-audit.md` and enforced by
`scripts/check-material-audit.mjs`. The hand-written inventory contains 201 exact rows covering
the desktop shell, every checked-in node, every destination and settings section, every dialog,
menu, dropdown, picker, tab, overlay, status state, empty state, error state, and every
documentation or landing page. The checker also validates source markers, style markers, shared
primitive exports, site-preservation wording, and a deliberate deleted-row mutation.

Source remediation in this lane includes the shared numeric field, radio, progress, and keyboard-
roving tabs primitives; adoption in worktree, toy-lock, authenticator, speech, converter, Ollama,
Minecraft, clone, History, and browser-tab surfaces; keyboard and Escape handling for the tooltip;
and named Material shape tokens for the reviewed desktop node, section, menu, picker, and compact
badge geometry. The public `AGENTS.md`,
`CLAUDE.md`, `CONTRIBUTING.md`, `README.md`, `ROADMAP.md`, and appearance documentation now state
that every rendered Windows desktop element uses Material Design 3 primitives and project tokens
with no element exemption.

The documentation and landing site is Kids mode by default. Its existing visual style is preserved
and no site restyling is part of this audit. Only stale site facts, data, releases, links, features,
accessibility, and broken behavior may be changed. The stale packaging article now describes the
current v0.4.117 release and push-triggered release workflow.

### Remaining conflicts and evidence boundaries

- The Comments & Activity panel in `src/renderer/components/kanban/CardModal.tsx` is inventoried
  separately as `destination-comments-activity`, but the file is reserved for the p80 lane.
- The existing-worktree picker in `src/renderer/components/WorktreeDialog.tsx` is inventoried
  separately as `overlay-existing-worktree-picker`, but further changes are reserved for p81.
- The WSL creator clipping state is inventoried as `overlay-wsl-create-clipping` and marked
  nonconforming and overlapping. The p79 lane owns the WSL creator repair, so this lane made no
  changes to those files.
- No tests, builds, runtime launches, pixel measurements, or captures were run in this lane. The
  source-only checker passes with 1,634 assertions, and the result must be re-read after
  integration.
## 2026-08-26, portable media assets and Include/Omit/Locate Later

Implemented `src/core/portable-media-assets.ts` with bounded image, audio, and video collection,
signature-based type detection, SHA-256 content addressing, regular-file validation, explicit
Include/Omit/Locate Later decisions, omission records, unresolved placeholders, and strict schema 3
manifest validation. Source paths are consumed only during local collection and are never retained
in portable records. Extended `src/core/portable-canvas-projection.ts` with an optional validated
media manifest field. Added the guided searchable decision surface at
`src/renderer/components/PortableMediaDecisionDialog.tsx`, plus the categorized article,
documentation index, Pages article, roadmap note, and changelog entry.

This lane deliberately did not run tests, type checking, linting, reviews, security checks, builds,
packaging, installer execution, runtime interaction, or captures. Archive entry production/import
wiring, destination Locate Asset handling, and built-artifact evidence remain pending. No commit or
push was made by this lane.

## 2026-08-26, portable media validation and guided export follow-up

Strengthened the media contract with exact allowlisted keys and reconstructed normalized output for
assets, omissions, and manifests. Unknown, unsafe, authority-bearing, `sourcePath`, and
`sourceName` fields cannot survive validation. Added bounded omission counts, duplicate and
case-collision refusal, included-versus-omitted contradiction checks, stable ordering, fatal UTF-8
manifest parsing, and bounded stable serialization. Media collection now hashes through a bounded
stream, retains only a small signature prefix, accepts an optional AbortSignal, and returns a
machine-local stream source rather than allocating a 512 MiB input. EBML is accepted only when its
bounded prefix identifies WebM; Matroska is refused.

The real project archive export route now opens the native multi-file media picker before saving,
shows the searchable Include/Omit/Locate Later decision surface, and leaves the existing archive
operation untouched when the picker is cancelled. The selected source path and source name remain
transient renderer state only. The archive writer still needs a follow-up adapter to consume the
selected streaming sources and emit schema 3 media entries; no portable record claims those paths.
No tests, builds, type checks, captures, commits, or pushes were made.
## 2026-08-27, shared provider services and local binding integration, issue #18

Added `src/shared/provider-services.ts` and `src/core/provider-services.ts` as the shared provider
boundary. Provider adapters now have one typed catalog, OAuth PKCE start/exchange contract, bounded
single-use callback ledger, account metadata shape, sealed credential store, and verified resource
discovery route. Desktop and Server Edition register the same core handlers. The preload and browser
bridge expose the same renderer API.

Reworked `PortableBindingWizard.tsx` to use guided, searchable connected-account and provider-
resource pickers, each with its own adjacent anchored regex builder. Hand-typed provider identity
and resource fields were removed. Configure, Rebind, and Adopt require a connected account and an
adapter-verified resource. Locate Asset uses the existing file picker. Deploy stays disabled until
a provider-specific adapter supplies it. Import still performs no network call, consent flow,
deployment, provider mutation, process launch, download, or binding action.

Provider secrets live only in `provider-accounts.json` under private application data, sealed by
the platform vault when available or stored through the established owner-only Server Edition
fallback. Local account/resource references live only in `portable-node-bindings.json`. Neither file
enters the schema 3 projection or export. Updated the integration article and index, portable-
binding article, documentation site article, changelog, roadmap, and handoff.

This ultra-speed lane did not run tests, type checks, lint, reviews, security or accessibility
checks, builds, packaging, installer execution, runtime interaction, or UI captures. Individual
provider adapters and provider-specific deployment behavior remain separate program lanes.

## 2026-08-27, portable media archive and bridge completion

Completed the four missing source boundaries from the portable-media checkpoint. The renderer no
longer imports filesystem collection code. `src/shared/portable-media.ts`, `src/shared/ipc.ts`,
`src/preload/index.ts`, and `src/main/index.ts` now provide a typed preparation route that returns a
single-use id and path-free candidates, plus bounded asset-id decisions and explicit cancellation.
The host expires unused preparations and consumes a preparation once at export.

`src/core/portable-media-assets.ts` now parser-proves decoded image dimensions and frame counts, WAV
timing, and MP4 or QuickTime timing and video dimensions. Recognised formats without a bundled
structural parser cannot be Included and retain an exact Locate Later or Omit route. Export re-reads
the file and refuses bytes that changed after preparation.

`src/core/portable-project-import.ts` now writes Included bytes to content-addressed
`assets/media/` entries covered by the outer schema 3 hashes. Import matches every resolved media
record to exactly one entry, repeats signature, hash, size, and parser-fact validation, stages media
beside the project metadata, and publishes the complete destination with one atomic rename.
`src/core/project-archive.ts` reports included media bytes and every Omit or Locate Later record
without a private path or machine identity.

No tests, type checks, lint, reviews, security checks, accessibility checks, builds, packaging,
installer execution, runtime interaction, captures, audits, or release work ran in this lane. The
source implementation is complete for issue #14 but remains intentionally unverified.
## 2026-08-26, atomic schema 3 import and destination binding wizard

Implemented schema 3 archive production and import wiring. `src/core/portable-project-import.ts`
validates complete archive inventory and SHA-256 metadata, migrates legacy snapshots in memory,
stages a destination beside the final path, refuses collisions, publishes with an atomic rename,
and removes only its own staging directory on cancellation or failure. Schema 3 exports carry the
validated canvas projection and history bundle plus safe omission records; credentials, vaults,
machine paths, provider sessions, processes, and caches remain out of the portable file.

Added `src/core/portable-bindings.ts` for versioned portable blueprints, private local binding
records, explicit Configure/Rebind/Adopt/Deploy/Locate Asset/Leave Unbound action state, bounded
progress and cancellation, atomic persistence, and rollback snapshots. Desktop IPC and preload
handlers persist only opaque local references and credential key names. The anchored renderer
wizard is `src/renderer/components/PortableBindingWizard.tsx`; Server Edition returns an explicit
desktop-only boundary and keeps imported projects unbound.

Updated `docs/features/projects/portable-bindings.md`, the projects index, `ROADMAP.md`, and this
handoff. The generated offline docs bundle still needs regeneration. No tests, type checks, lint,
security checks, builds, packaging, installer execution, runtime interaction, captures, commit,
push, or publication were performed in this lane.
## 2026-08-26, unified Node Catalog implementation

Implemented the typed Node Catalog registry in `src/shared/node-catalog.ts` and the renderer
creation coordinator in `src/renderer/state/nodeCreationCoordinator.ts`. Registry rows carry stable
ids, node kinds, categories, keywords, documentation paths, dependency ids, safe defaults, and
availability reasons. The coordinator stamps immutable `creationEventId` values, deduplicates retry
events, and chooses a deterministic collision-free rectangle. `CanvasNodeState` and live node data
persist the event id while hydration only remembers it.

Added `src/renderer/components/NodeCatalogDialog.tsx`, with category navigation, plain-text search,
an anchored full regex builder, keyboard navigation, focus restoration, disabled-state explanations,
accessible listbox state, and per-row documentation links. The FAB, pane context menu, group context
menu, and command palette now expose the catalog route. Added localized catalog copy, Material Design
3 styles, a categorized feature article, offline site article, roadmap state, and this handoff.

This ultra-speed implementation pass intentionally did not run tests, type checks, lint, reviews,
security or accessibility checks, builds, packaging, installer execution, runtime interaction, or
UI captures. The generated offline documentation bundle was refreshed through the docs generator's
equivalent TypeScript-strip route because the checkout has no installed `esbuild`; this was a docs
generation step, not a product build. Build and packaging evidence therefore proves artifact
production only. No commit or push was made by this lane.

The refuter repair adds an explicit current, ephemeral, and planned catalog completeness inventory;
universe scope and depth metadata; configure-later versus required-for-creation states; disabled
blueprints for every planned node family; strict remote-terminal picker refusal; sibling-coordinate
placement; bounded placement refusal with a visible notification; fresh event ids for duplicates;
append coordination across shortcut, drop, paste, board, source-control, login, profile,
automation, and peer creation; personal-vocabulary localization with bilingual secondary copy;
in-app documentation navigation; and catalog-driven terminal-profile and authenticator dragging.
## 2026-08-26, special-universe Shop node and scope enforcement, issue #17

Implemented the lane-6 Shop invariant in `src/core/universe-shop.ts`. Each Multiverse or AWS
Universe child canvas receives exactly one deterministic `shop-<canvas-id>` node, while root and
other scopes receive none. The pure coordinator repairs missing, duplicate, normalized, and
invalid-scope records without network or provider side effects, filters one shared catalog by
universe scope and Multiverse depth, and keeps invalid regex searches visible and bounded. The
catalog is supplied through `UniverseShopCatalogProvider`, so this lane does not fork p05 labels or
factories. Until p05's unified registry is available at integration, the Shop remains visible but
creation is disabled with an explicit dependency reason. A collision-safe stable suffix is selected
when `shop-<canvas-id>` is already occupied; if both deterministic candidates are occupied, repair
refuses creation and preserves the ordinary nodes.

The projection now carries safe universe ownership and non-deletable metadata. `shop` is a typed
canvas node kind with a fixed renderer card in `src/renderer/nodes/ShopNode.tsx`; its local search
has an adjacent anchored full regex builder, accessible labels, result counts, visible focus, and
English/Cantonese/bilingual copy from the shared language catalog. React Flow mutation boundaries
refuse Shop drag, resize, deletion, duplication, grouping, movement, title rename, and ordinary
undo paths. The core coordinator also refuses the same peer mutation operations, preserves ordinary
nodes on Shop-id collisions, mints immutable creation event ids only for live universe creation,
and deduplicates peer creation events. `createSpecialUniverseCanvas` is the live child-canvas
constructor and inserts the Shop in the same operation. A live catalog creation callback is exposed
for the unified p05 coordinator to provide collision-free placement and actual node creation.
Missing or malformed
scope, depth, and containing-canvas metadata fails closed instead of creating a Shop in an ambiguous
location.

Changed files: `src/core/universe-shop.ts`, `src/core/portable-canvas-projection.ts`,
`src/shared/types.ts`, `src/shared/i18n/catalog.ts`, `src/renderer/state/workspace.ts`,
`src/renderer/canvas/Canvas.tsx`, `src/renderer/nodes/ShopNode.tsx`,
`src/renderer/state/projects.ts`, `src/shared/canvas-mutations.ts`,
`src/renderer/styles.md3.css`, `docs/features/integrations/aws-universe-shop.md`,
`docs/features/integrations/README.md`, `docs/features/projects/portable-canvas-projection.md`,
`ROADMAP.md`, `CHANGELOG.md`, `docs/uh-feature-inventory.md`, and this handoff.

No tests, type checks, lint, security checks, builds, packaging, runtime interaction, or captures
were run, and no commit or push was made, as explicitly required for this lane. The documentation
bundle generator could not run because `esbuild` is not installed in this working copy. The changed
article entries were synchronized mechanically into `src/shared/docs-data.ts`, but the generator
still needs to run once that dependency is available before a release-grade handoff.
## 2026-08-26, issue #20 media node implementation

Added `src/shared/media-catalog.ts` with Photo, Video, and mixed Gallery catalogue registration,
portable content-addressed reference validation, and bounded byte-signature checks. Added
`PhotoNode.tsx` and `GalleryNode.tsx`, wired the new node kinds, factories, serialization fields,
open-file routing, palette/context creation, and responsive media styling. Shared project saves
strip transient absolute `sourcePath` hints while retaining portable metadata and explicit missing
asset states. Added the feature article at
`docs/features/canvas/media-gallery.md` and recorded the unfinished verification state in the
roadmap and changelog.

This lane deliberately did not run tests, type checking, builds, packaging, UI interaction, or
captures, and made no commit or push. The parent integration lane must run those checks and inspect
the built artifact before treating issue #20 as verified.

The resumed issue #20 lane completed the checkpoint's missing serialization and durable-byte
boundaries. Photo and Video `filePath` values plus Gallery `sourcePath` values now round-trip only
through the machine-local node overlay. Schema 3 carries ordered media references and the active
Gallery asset, reconciles each reference against the media manifest, and marks references missing
when no byte carrier exists. Archive export collects supported media by bounded streaming, re-reads
and verifies byte count, signature, and SHA-256, writes content-addressed `assets/media/` entries,
and records them in the outer manifest. Import validates those entries before writing, stages them
inside the new project root, and publishes atomically. The shared resolver now requires byte-count
and digest evidence instead of returning a path-shaped guess.

This resumed lane ran no tests, type checks, lint, reviews, security or accessibility checks,
builds, packaging, installer execution, runtime interaction, or captures, as required by the
ultra-speed boundary. The coordinating integration lane owns those verdicts, default-branch
integration, release publication, and capture evidence.
## 2026-08-26, Torrent Downloader implementation lane

Added the dedicated `torrent` canvas node, shared downloader contract, CorePlatform-backed service,
IPC registration for Desktop and Server Edition, preload and WebSocket bridges, and the relay
unsupported degrade. The service prefers the declared or packaged WebTorrent runtime and attempts a
pinned user-scoped `webtorrent@2.8.1` install when it is absent. It keeps queue state under the
application data directory, reconciles in-flight tasks after restart, reports metadata and selected
files, validates destination containment and free space, and supports pause, resume, cancel, retry,
progress, peer count, speed, ETA, and bounded seeding policies.

The canvas record carries only safe display intent (`torrentMagnet`); local source paths,
destinations, runtime handles, peer state, and task snapshots never enter the portable project
file. Added the categorized torrent documentation and inventory entry. `package.json` and
`package-lock.json` declare `webtorrent` 2.8.1.

The follow-up implementation on `feat/program-12-torrent-downloader` corrects the package's ESM
loading boundary, keeps inspected tasks attached to their owning canvas node, and makes inspection,
destination binding, file selection, and start separate user actions. Every task now has isolated
plain-text-first file and seeding policy searches with adjacent full anchored regex builders. Task
removal uses the shared two-key destructive confirmation, and duration seeding begins its timer
when completion is observed instead of when the policy is selected.

This ultra-speed implementation lane intentionally did not run tests, type checks, lint, builds,
packaging, installer execution, runtime interaction, UI captures, audits, or reviews. The docs
bundle generation, focused tests, built-artifact interaction proof, release packaging, integration,
and remote verification remain for the owning integration pass.
## 2026-08-26, Linux ISO VM node, issue #24

### Issue #24 completion repair, 2026-08-27

Restored parseable package scripts, node-kind tables, desktop bridge objects, browser fallback
objects, and Server Edition bridge functions after the parallel program-lane merge. Corrected
QEMU's VNC display-number to loopback-port mapping and kept Stop operable while startup is
pending. The manager now distinguishes cancellation from startup failure, reports a QMP stop failure
after bounded process termination, refuses to collapse unreadable state into an absent record, and
publishes unique temporary state files through the shared bounded atomic rename helper. Snapshot
restore now uses the machine-local saved-name catalogue, plain-text filtering, and the shared
anchored regex builder instead of freehand restore input. The new picker copy is present in English
and playful Cantonese resources. The mode dropdown now has its own plain-text filter and isolated
anchored regex builder too.

This completion repair intentionally ran no tests, type checks, lint, builds, packaging, runtime
interaction, captures, audits, or reviews. Those verdicts remain unrun rather than inferred.

Implemented the one-shot `linux-vm` canvas node and its shared lifecycle contract. The renderer
provides guided ISO and persistent-disk pickers, persistent-install and disposable-live modes,
bounded memory and CPU controls, explicit network-off-by-default and WHPX preference switches,
snapshot/restore controls, loopback VNC/QMP status, and visible recovery messages. The manager
spawns only bundled QEMU resources through a fixed argv vector with `shell: false`, validates paths
and identifiers, and keeps QMP/process state in machine-local application data.

Portable configuration is carried by `virtualMachineConfig` in the schema 3 project projection.
ISO and disk paths are carried by `virtualMachineLocalPaths` in the existing local execution
overlay and are stripped from shared project files and peer mutations. The API is registered for
both the desktop and Server Edition shells, with preload and WebSocket bridges. The node is in the
canvas manager catalog and node recreation path.

Changed files include `src/shared/virtual-machine.ts`, `src/core/virtual-machine/`,
`src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/node-exec.ts`,
`src/renderer/state/workspace.ts`, `src/renderer/nodes/VirtualMachineNode.tsx`,
`src/renderer/canvas/Canvas.tsx`, preload and Server Edition bridges, the integration documentation,
offline docs data, site docs, `CHANGELOG.md`, `ROADMAP.md`, and this handoff.

This lane deliberately did not run tests, type checks, lint, reviews, security checks, accessibility
checks, builds, packaging, installer execution, runtime interaction, or captures. The docs bundle
generator was attempted but could not run because `esbuild` is absent in this isolated checkout;
the generated offline data entry was added directly. No commit or push was made by this lane.

### Refuter repair pass

Added pinned QEMU 10.1.0 Windows x64 manifest metadata with official installer SHA-512, size
disclosure, required packaged payload paths, the `resources/qemu` packaging boundary, and the
`scripts/ensure-qemu-resources.mjs` bootstrap wired into the Windows packaging path. Added
QEMU self-probed WHPX selection with TCG fallback, ISO SHA-256 expected/actual reporting, qcow2
magic-byte versus raw disk detection, free-space preflight and guided persistent-disk creation,
loopback port preflight/retry, QMP and display socket startup handshakes, bounded QEMU diagnostics,
startup cancellation generations, stale-process reconciliation, serialized atomic state writes with
transient rename retries, awaited shutdown, a desktop display-open action, and a Server Edition
honest no-proxy response. VM duplication now clears machine-local ISO and disk bindings. Added
source coverage entries for these boundaries. No tests, builds, captures, commit, or push was made.
## 2026-08-26, planner occurrence service lane

Implemented a host-owned planner occurrence service that keeps durable schedules alive after the
Desktop window or Server Edition browser tab closes while the computer remains available. Added
`src/shared/planner-occurrences.ts` for bounded schema, recurrence, timezone, DST, repeated and
nonexistent wall-clock handling, cross-midnight descriptions, deterministic occurrence ids, and
missed-occurrence classification. Added `src/core/planner-occurrence-service.ts` for atomic local
storage, bounded background evaluation, deduplication, occurrence history, JSON/CSV export, IPC/WS
events, and lifecycle stop handling. Desktop starts the service with an OS notification callback;
Server Edition starts the same core service and stops it in both close paths. Neither surface claims
to wake a powered-off computer.

Added the guided Planner settings surface with native date/time controls, populated timezone
selection, recurrence choices, an anchored regex builder, schedule toggles, history, and exports.
Updated `src/shared/ipc.ts`, `src/shared/types.ts`, `src/preload/index.ts`,
`src/renderer/bridge/ws-bridge.ts`, `src/renderer/bridge/stubs.ts`, settings navigation/icons,
the integrations feature index and planner article, the feature inventory, ROADMAP, and CHANGELOG.
The committed offline docs bundle still needs regeneration through `scripts/build-docs-bundle.mjs`.

The issue #29 repair lane corrected the Desktop title-bar close path so an enabled planner keeps the
host process alive after the UI window closes. Planner store mutations are now serialized, renderer
saves replace only user-authored schedule definitions, and fired or missed occurrences are persisted
before delivery. The Planner surface reloads durable state after a refused save, provides retry, and
routes schedule deletion through the two-key destructive confirmation gate.

The issue #29 repair lane now includes schema 3 planner-definition transfer. `src/core/portable-planner.ts`
validates a bounded planner blueprint containing schedule intent only. Schema 3 export includes that
blueprint from the host-owned planner store, while import returns it without applying schedules or
performing external side effects. The completed import notification exposes an explicit Configure
action, which calls the host planner service and merges imported definitions without overwriting a
conflicting destination definition. Occurrence history, last-tick state, credentials, paths,
process state, and provider state remain local.

The generated offline documentation bundle was refreshed from
`docs/features/integrations/planner-occurrences.md` using the existing bundle renderer. The
implementation lane still intentionally leaves tests, type checks, lint, builds, packaging,
installer execution, runtime interaction, accessibility review, and screenshots unrun.

This ultra-speed lane deliberately did not run tests, type checks, lint, security checks, builds,
packaging, installer execution, runtime interaction, accessibility review, or screenshots. Those
checks remain unrun for this repair lane.
## 2026-08-26, Calendar nodes lane #30

Implemented the Calendar node surface on `feat/program-19`: local calendars and ICS import, plus
guided CalDAV, Google Calendar, and Microsoft 365 account/calendar choices. Added the portable
`calendarConfig` node shape, calendar IPC/API seam for Desktop and Server Edition, bounded ICS
parser, machine-local event cache, Agenda/Week/Month views, timezone and weekend controls,
anchored event regex builder, create/edit preview, and two-key delete confirmation.

Changed files include `src/shared/calendar.ts`, `src/core/calendar/service.ts`,
`src/core/calendar/register-ipc.ts`, `src/renderer/nodes/CalendarNode.tsx`, node-kind registration
in `src/shared/types.ts` and `src/renderer/state/workspace.ts`, bridge wiring in `src/preload/index.ts`,
`src/renderer/bridge/stubs.ts`, `src/renderer/bridge/ws-bridge.ts`, and `src/renderer/bridge/relay-api.ts`,
the Canvas menu and registration, and calendar styling in `src/renderer/styles.css`.

Security boundary: project state contains no source paths, provider sessions, host identifiers,
OAuth state, access tokens, refresh tokens, or event cache. Provider status is conservative and
CalDAV remains explicitly unavailable until a trusted adapter supplies vault-backed credentials.
No secret export or arbitrary URL entry point was added.

This ultra-speed lane deliberately ran no tests, type checks, lint, security/accessibility review,
build, packaging, installer execution, runtime interaction, or captures. The docs bundle generator
could not run because `esbuild` is absent in this working copy, so the new article was recorded in
the existing Canvas node-kind article and the categorized feature index instead. No commit or push
was made by this lane.

Refuter repair: remote provider catalogs no longer synthesize connected accounts, primary calendars,
or writable CRUD. All remote provider actions remain disabled with an explicit unavailable reason
until a real OAuth PKCE, pagination, validator, and OS-vault adapter is installed. Core node ids are
validated before cache paths are formed. ICS import now uses UTF-8 byte limits, strict date/range
validation, UID deduplication, TZID validation, and source-identity-aware durable cache records.
Import runs through the core service rather than saving a renderer-only cache. The node now uses the
shared anchored regex builder for event, source, and timezone searches, real period navigation and
tabpanel ARIA wiring, event selection/export, and local undo. No verification commands were run.

Provider continuation on `feat/program-19-calendar-nodes`: added host-owned CalDAV, Google Calendar,
and Microsoft 365 adapters without duplicating the local and ICS foundation. The adapters enforce
HTTPS and provider host boundaries, bound response size, pages, events, and request duration, retain
revision or ETag evidence, and preserve the previous cache with exponential retry timing after a
provider failure. Remote create, update, and delete return only provider-confirmed outcomes.

Credentials now live below the machine's application-data directory through
`src/core/calendar/vault.ts`. Desktop uses the core platform sealing hooks; Server Edition uses a
restricted local file. OAuth uses an ephemeral loopback PKCE callback and a machine-local public
client registration file. CalDAV uses a guided endpoint, username, and password form, verifies the
calendar collection before saving the account, and removes the credential if verification fails.
Account and calendar searches each have their own adjacent anchored regex builder. Disconnect uses
the existing two-key confirmation flow and retains cached events.

Changed continuation files: `src/shared/calendar.ts`, `src/shared/ipc.ts`,
`src/core/calendar/providers.ts`, `src/core/calendar/vault.ts`, `src/core/calendar/service.ts`,
`src/core/calendar/register-ipc.ts`, `src/preload/index.ts`,
`src/renderer/bridge/ws-bridge.ts`, `src/renderer/bridge/stubs.ts`,
`src/renderer/nodes/CalendarNode.tsx`, `docs/features/calendar/README.md`, `CHANGELOG.md`,
`ROADMAP.md`, `HANDOFF.md`, and the offline documentation record.

No tests, type checks, lint, builds, packaging, installer execution, runtime interaction,
accessibility or security review, audits, or captures were run in the continuation. Provider
behavior and release assets therefore remain unverified, and this handoff must not be read as a
runtime or packaged-artifact verdict.

## 2026-08-27, Calendar node portability and synchronization repair

This worker lane keeps the Calendar scope on `feat/program-19-calendar-nodes`. Incremental Google and
Microsoft 365 synchronization now merges changed records into the existing cache and applies
provider tombstones, so a delta response cannot erase unchanged events. Provider response bodies
are streamed through an 8 MB bound before decoding. Calendar project-file boundaries now normalize
calendar node configuration to the documented portable allowlist, dropping unknown fields on both
read and write.

Calendar picker regex builders are anchored to their adjacent filter fields, not to the native
select controls. Week and agenda navigation uses the active period, weekend visibility is applied
to ranged views, and edit forms render saved instants in the selected timezone before converting
them back for persistence. Changed files are `src/core/calendar/providers.ts`,
`src/core/calendar/service.ts`, `src/core/workspace-files.ts`,
`src/renderer/nodes/CalendarNode.tsx`, `docs/features/calendar/README.md`,
`src/shared/docs-data.ts`, and `CHANGELOG.md`.

Commit: `fe35fc986e06d857ca7c2ae67193b9785be20b39`. Tests, type checks, lint, builds, packaging,
installer execution, runtime interaction, accessibility or security review, audits, and captures
remain unrun by the issue's ultra-speed boundary.
## 2026-08-26, Alarm Clock node lane

Implemented the Alarm Clock canvas node and shared durable planner primitives for one-shot, daily,
weekday, weekly, and monthly wall-clock schedules. `src/shared/alarm-clock.ts` resolves IANA
timezones with deterministic daylight-saving gap and fold handling, bounded occurrence history,
snooze, dismiss, missed-occurrence classification, and persistence hooks. The node stores only safe
schedule intent and redacted occurrence metadata in the project projection, exposes guided date,
time, timezone, recurrence, weekday, monthly-day, sound, narrator, snooze, history search, and
anchored regex controls, and visibly states that it cannot wake a powered-off computer. Due events
use the existing non-blocking notification store, sound effect, and serialized narrator queue.

Updated `src/shared/types.ts`, `src/renderer/state/workspace.ts`,
`src/renderer/canvas/Canvas.tsx`, `src/renderer/components/FabMenu.tsx`,
`src/core/portable-canvas-projection.ts`, both renderer style sheets,
`docs/alarm-clock.md`, `docs/features/projects/README.md`, `ROADMAP.md`, and `CHANGELOG.md`.

The original ultra-speed checkpoint intentionally did not run tests, type checks, lint, reviews,
security checks, accessibility checks, builds, packaging, installer execution, runtime interaction,
or captures. It landed in `716f0a9f82c83c0c52f284ade19adb6f208b3b03` for later completion.

### 2026-08-27 completion checkpoint

The existing file-backed planner now has a production lifecycle owner and bounded request handlers
in both Desktop and Server Edition. The desktop bridge mirrors validated node schedules into the
host snapshot, receives due events, and routes Snooze, Dismiss, and node removal back to that host.
Alarm Clock is an active, localized Node Catalog entry and the shared catalog creation coordinator
creates the existing paused, timezone-aware Alarm Clock node rather than returning no node. This
checkpoint intentionally ran no tests, type checks, lint, builds, packaging, runtime interaction,
reviews, or UI captures. The offline documentation bundle was not regenerated because generation
was excluded with the build boundary; the authored Alarm Clock and Node Catalog articles are current.

## 2026-08-26, portable canvas projection implementation

Implemented `src/core/portable-canvas-projection.ts`, re-exported through
`src/core/project-archive.ts`. The module projects safe root canvas content and future Multiverse
and AWS Universe scopes into deterministic schema 3 JSON, preserving display metadata, geometry,
node presentation, grouping, relationships, ordering, and bounded appearance values. It excludes
machine-local, credential, process, provider, browser-profile, path, endpoint, and other
authority-bearing state, and rejects those fields on imported payloads. Serialization emits stable
UTF-8 bytes and validation enforces bounded counts, depth, strings, references, and bytes without
hydrating or starting anything.

This lane deliberately did not run tests, type checking, linting, security checks, builds,
packaging, installer execution, UI interaction, or captures. Archive writing, atomic import,
media, catalog, Shop, portals, providers, and UI remain unimplemented risks for later lanes. No
commit or push was made by this lane.

## 2026-08-26, projection validation tightening

The projection validator was tightened after review. Numeric bounds now apply to every finite
number, future canvas input is reconstructed from allowed fields rather than spread, and imported
objects use strict allowed-key sets at every schema level. Canvas hierarchy validation now enforces
one root, parent existence, child-parent requirements, no self-parent or cycle, and depth eight.
Node membership is unique and complete, node parents are validated, and relationship identifiers
are unique without case collisions. HTTP(S) URLs are normalized without embedded credentials or
control characters, while empty content remains valid and required labels remain non-empty. Tag
and browser-tab counts are bounded. No tests, type checks, lint, builds, packaging, UI interaction,
or captures were run, and no commit or push was made by this lane.

## 2026-08-26, normalized projection boundary

Validation now reconstructs and returns an allowed normalized copy, including canonical HTTP(S)
URLs and omitted empty URLs. It explicitly validates every optional field and nested shape, icon
allowlists, numeric and collection bounds, canvas hierarchy and membership invariants, and converts
malformed input into `PortableProjectV3Error`. This lane keeps only strict global appearance fields;
per-element appearance is postponed until a typed schema exists. No tests, type checks, lint, builds,
packaging, UI interaction, or captures were run, and no commit or push was made by this lane.

## 2026-08-26, portable schema 3 envelope implementation

Follow-up repair keeps `manifest.json` as required archive framing outside the hashed payload
inventory, removes vault material from optional entries, validates recorded raw and compressed
sizes, applies all count and byte limits during manifest creation, validates user omissions, and
uses fatal UTF-8 decoding. V1/V2 migration is now bounded and recursively strips nested credential,
token, password, path, account, session, SSH, machine-local, and exact identity keys such as `id`
while preserving unrelated keys that merely contain those letters. It rejects unsafe object keys
and values. Project colours, non-empty bounded names, omission counts, duplicate omission paths,
case collisions, and omission contradictions are validated as well. Parsed manifest metadata is
checked against per-entry and aggregate byte ceilings before payload handling.

Implemented `src/core/portable-project-v3.ts`, a platform-free schema 3 contract and validator,
and re-exported it from `src/core/project-archive.ts`. The module provides the
`nodeterm-portable-project` identifier, schema version 3, canonical required and optional entry
inventory, bounded manifest and omission types, safe relative path validation, duplicate and
case-collision refusal, SHA-256 payload metadata that excludes the required manifest framing,
raw and compressed byte ceilings, and bounded recursive V1/V2 migration filtering that excludes
machine-local and credential material. Vault material is not an optional entry. Added the feature
article and projects documentation index entry.

This lane deliberately did not run tests, type checking, linting, reviews, security checks, builds,
packaging, installer execution, UI interaction, or captures. The roadmap item remains unchecked
until archive production/import wiring and those verification activities land. No commit or push was
made by this lane.

## 2026-08-27, managed Nextcloud no-socket hosting lane

Issue #53 is implemented on feature branch `feat/program-42-nextcloud-managed` at pushed commit
`9f1406a9dd9758471b6ebad77aed662f1cc22850`. The new `nextcloud-managed` node kind uses a fixed
PostgreSQL, Redis, and Nextcloud Apache stack, an internal network, loopback-only web binding,
generated local secret files, and no Docker socket mount or privileged mode. The renderer exposes
verified Docker context selection, native data and backup folder pickers, bounded project name and
port controls, separate operation and snapshot search fields with adjacent anchored regex builders,
progress, cancellation, and two-key recovery confirmation. The host process owns the closed Docker
argument vector and sequences deploy, update, backup, restore, and rollback operations.

Portable schema 3 carries only `nextcloudManagedIntent`. Machine-local `nextcloudManagedBinding`
holds the selected context, folders, loopback port, and opaque secret-key names through the local
execution overlay. Import does not call Docker, write secrets, deploy, launch, or download.
Updated source and direct documentation include `src/shared/nextcloud-managed.ts`,
`src/main/remote/nextcloud-managed.ts`, the Nextcloud renderer panel, node registration, portable
projection handling, `docs/features/integrations/nextcloud-managed.md`, and the offline article
entry.

This ultra-speed lane intentionally ran no tests, type checks, lint, reviews, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or captures.
Those verification results remain unrun. Default-branch integration is pending.

## 2026-08-26, portable Node Universes and hosting program plan

Plan-only lane status. The public implementation plan is recorded in
[`docs/plans/2026-08-26-portable-node-universes-and-hosting-program.md`](docs/plans/2026-08-26-portable-node-universes-and-hosting-program.md)
and indexed by [`docs/plans/README.md`](docs/plans/README.md).

The plan source baseline is `27ecfa62e5b3180070abaa241f8bac6b1e079861`, which was an ancestor of
`origin/main` when this lane started. It covers schema 3 portable project saves, portable
blueprints and local bindings, the unified Node Catalog, universe Shop nodes, Material Design 3
surfaces, media and file conversion, torrents, Linux ISO virtual machines, Home Assistant sensor displays,
calendar, timer and alarm tools, Multiverse portals, a complete interactive AWS CLI GUI, Docker
host management, GitLab, Nextcloud, Open WebUI, Cloudflare managers and tunnels, clean-room
WinForge-inspired nodes, upstream parity, public issue records, and the new upstream pull request.

No product code was changed. No GitHub issue, discussion, project, pull request, release, tag,
branch, or worktree was mutated. Tests, type checking, linting, reviews, security checks, builds,
packaging, and captures were not run in this plan-only lane. The ultra-speed release boundary is
retained for future implementation work: it intentionally skips those checks and captures while
requiring exact artifact and release evidence.

## 2026-08-22 — vendored paste-frame duplicate + drift guard

`src/core/paste-injection.ts` is a deliberate vendored duplicate of `agent-whip/packages/paste-frame/src/index.ts` (sibling repo, not a dependency — material-nodeterm is public, that package is unpublished, a `file:` dependency would dangle for anyone cloning this repo alone). `scripts/check-paste-frame-parity.mjs`, wired into `npm run typecheck`, fails loudly if the two drift and skips cleanly when the sibling checkout is absent. Full writeup: `docs/paste-frame-vendoring.md`. This is a mitigation, not the fix — the fix is publishing the package once registry rights exist.

## 2026-08-20, second pass — a hunt that found real defects, and the fixes that landed

`main` moved `f5caf128 -> f0a0453e`. Suite fully green at the tip: **717 files, 8,852 tests,
0 failed**. Three read-only hunters swept the repository's own documented failure families;
everything below was verified by command before being believed, and fixed in four isolated
lanes, each proven red-then-green and re-proven here independently before merging.

### Shipped

- **Word separators** (`0b59782a`, upstream #349) — double-click now keeps identifiers, paths
  and package names whole. One setting reaches THREE writers (xterm, local tmux conf, remote
  tmux conf) because tmux owns the mouse and an xterm-only change is a no-op; the value is
  re-validated at the interpolation site since it lands in a config written onto SSH hosts.
  Bonus fix: SSH projects had ignored `tmuxScrollback` forever (hardcoded 50000) — the new
  settings seam in `SshProjectManager` closes that too.
- **Three dead ADHD modes wired** (`d697f78f`). Time awareness renders an elapsed chip in the
  node header and the kanban card modal (ONE module-level ticker, started by the first
  subscriber); Momentum floats its dismissible note over the terminal top (never resizing the
  body — a resize is a SIGWINCH); Low stimulation's notification half now actually filters,
  with needs-you provably never silenced and quieted items landing pre-dismissed in the centre
  rather than vanishing. Worth reading in that lane's history: its first gate break stayed
  GREEN because two independent gates covered the same render — the duplicate was removed so
  the gate has one owner.
- **Server Edition transcript search** (`82bc8b19`) — `transcript:search` moved from an inline
  main-only registration into `core/transcript-ipc.ts`, which both shells call; the browser
  palette's transcript results now exist. The textbook 'logic left in src/main silently does
  not exist on the server' case, in a file that otherwise did it right.
- **Server Edition transfer menu** (`15d6cb6e`) — was visible, enabled, and threw into a
  voided promise. Now follows the house `supported`-bit pattern (the PairingApi precedent):
  hidden where absent, caught with an honest toast as the second boundary, documented in
  SERVER.md.
- **Four bare Windows renames fixed and the guard taught to see them** (`63407c1a`).
  `windows-installer.mjs` published metadata with a bare rename on the `dist:win` path — the
  exact Defender-EPERM case `renameAtomic` exists for, in the Windows installer itself. A
  shared bounded-retry helper now lives at `scripts/lib/rename-atomic.mjs`; the fs-atomic
  guard scans `scripts/` and non-.ts files (it could not see any of this before); its lazy
  import-strip hole is closed with the arming input pinned as a fixture; both `no-electron`
  guards now catch dynamic `await import('electron')` and carry non-empty floors; and the
  theme test's `s`-collapsed-to-`s` regex is repaired.

### Corrected guard needles, each watched failing

`check-app-contract.mjs`'s session-memory needle was the two-letter string `ok` (satisfied by
'looking'); the AnchoredRegexBuilder row's needle was the bare keyword `export` and its
`wiredInAny` counted import lines and comments; the docs inventory sweep read `docs/`
non-recursively — 58 of 94 docs, none of `docs/features/`. All fixed and independently
re-broken here before being believed: collapsing the session-memory discriminator now goes
red on a line-anchored return-shape regex; planting a bare rename in `scripts/` goes red;
planting a dynamic electron import in core goes red.

### Still open from the hunt

- `check-site-contract.mjs:252`'s `voiceschanged` needle points at a file whose only match is
  a comment; the real subscription is `site/app/main.js:440`. Site guard — not fixed in this
  pass, which took only app-side lanes.
- `hook-identity-enforcement.test.ts:426`'s whole-file needles survive commenting out the one
  wiring line.
- The `KIDS_DISCLOSURE` needle is comment-satisfiable.
- `agent-status-mirror.ts:507` still rolls its own cross-dialect basename against the
  sanctioned `core/path-basename.ts` verdict.
- The ADHD surfaces owe a packaged capture (three states named in `docs/adhd-modes.md`), and a
  visual check at narrow widths / 200% scale.
- **The blur verdict, for whoever picks this up**: PHASE is fixed on `main`; the SCALE branch
  helps only zoomed IN (0% at zoom 1.0 and out). Correction to an earlier version of this line:
  the zoom-out case is NOT "needs supersampling" — at zoom < 1 the raster is already denser than
  the display needs (built at `dpr`, display needs `dpr × zoom < dpr`), so the loss is
  RESAMPLING (the compositor bilinearly shrinking an already-big-enough raster), not a resolution
  shortfall a denser raster would fix. What `RASTER_SCALE_MIN_FACTOR = 1` actually forbids is the
  raster getting COARSER to match the display exactly, i.e. letting the font rasterizer draw the
  smaller glyphs directly with real hinting/AA instead of the GPU downsampling. One of its two
  stated reasons for the floor is disproven (measured: the mip chain engages zero levels above a
  0.5 ratio); the other (a rebuild on every zoom OUT, not just in) stands, and the column-reflow
  proof (`cellWidthIsStable`) has only ever been derived for the zoom-IN direction — going
  coarser is unproven, not merely un-shipped. A device eyeball at 150% remains the gate for both.


## 2026-08-20 — six branches integrated, and the stale-failure list retracted

`main` moved `289fcb47 -> baf67860`. Six of the eight open branches are merged and **proven
ancestors of the pushed `main`** with `git merge-base --is-ancestor`, not assumed:
`feat/suites-a`, `feat/suites-b`, `feat/openrows`, `feat/uh-feature-inventory`,
`fix/pairing-no-qr-dead-end`, `feat/project-single-file`. All six merged with zero conflicts.

### Retraction: the seven failing test files are all green, and were before this pass started

The section below headed "The seven failing test files, with cause" is **stale**, and it is worth
saying plainly because the next reader would otherwise spend an afternoon re-diagnosing fixed bugs.
Every one of those seven files passes at `main`, measured by running them rather than by reading:

| File the addendum listed as failing | Measured now |
|---|---|
| `src/renderer/styles.theme.test.ts` | passes |
| `src/core/fs-atomic.guard.test.ts` | passes |
| `src/renderer/state/permissionMode.funnel.test.ts` | passes |
| `src/renderer/nodes/ServiceNode.test.tsx` | passes |
| `src/renderer/terminal/webgl-addon-pair.test.ts` | passes |
| `src/core/build-bat.test.ts` | passes |
| `src/main/remote/relay-host-service.test.ts` | passes |

147 tests across those seven files, 0 failures. The 51 commits that landed between `38280b0b`
and `289fcb47` fixed them; the document was simply never updated. The named `.mc-console`,
`--mono`, bare-`fs.rename` and Kids-mode funnel defects are all closed.

### Verified at the integration tip

| Check | Command | Result |
|---|---|---|
| Full suite | `npx vitest run` (alone, uncontended) | **706 files: 700 passed, 6 skipped. 8,912 tests: 8,720 passed, 192 skipped, 0 failed.** 121.24 s, exit 0. Measured at `2cb5882d`, the merge tip. |
| Type checking | `npm run typecheck` | Clean on both projects, exit 0. |
| Production build | `npm run build` | exit 0. |
| Feature inventory | `node scripts/check-uh-inventory.mjs` | 37 shipped, 2 not-applicable, 5 open; all 44 required features present, every shipped path exists. |
| App contract | `node scripts/check-app-contract.mjs` | 835 assertions across 49 features, **1 failure** — the pre-existing Windows terminal-profile row still owing packaged headless capture evidence. |
| Site contract | `node scripts/check-site-contract.mjs` | 366 assertions, all clear. |
| Instruction mirror | `node scripts/check-instruction-mirror.mjs` | OK, 8 markers in each of README.md and AGENTS.md, no leak pattern matched. |
| Vocabulary lock | `node scripts/check-vocabulary.mjs` | Passed (re-locked at the start of this pass — the dictionary had changed and the build correctly refused until it was re-read). |

### Three defects the integration itself surfaced, all fixed here

1. **A shipped article that never entered the docs bundle.** `feat/uh-feature-inventory` added
   `docs/uh-feature-inventory.md` and never regenerated `src/shared/docs-data.ts`, so the in-app
   documentation browser had 89 articles and no route to the 90th. The docs-bundle guard failed
   the first build after integration — exactly the job it exists for. Regenerated to 90 articles.
2. **A fail-closed guard with nothing to run it.** `scripts/check-uh-inventory.mjs` arrived on the
   same branch as the guard over all 44 canonical features, and nothing called it: no npm script,
   no build step, no workflow. Its only two references in the whole tree were its own header
   comment and the document describing it. It is now wired into `build` beside the vocabulary,
   changelog and docs-bundle checks, and `check:uh-inventory` / `check:site-contract` exist as
   runnable scripts. Both passed at the time of wiring, so this costs nothing today and catches
   the next drift.
3. **The new inventory document had no contract row.** The app contract's completeness sweep asked
   where its feature row was; the honest answer is that it is the register OF the contracts rather
   than a forty-fifth one, so it is now exempted in `NON_FEATURE_DOCS` **with that reason stated**.

### Three delegated lanes, landed

Run as isolated workers in their own isolated checkouts, each reviewed and independently re-verified
here rather than accepted on its own report.

**Converter defects** (`913bffe9`). `README.md` was detected as `xml` because the file opens with
an embedded HTML block and the generic leading-tag heuristic ran *before* the Markdown extension
check. Fixed in the producer, with no filename special case: an explicit `<?xml` declaration stays
authoritative, a known Markdown extension now outranks a merely generic tag, and the broad
XML/HTML heuristic moved below both. Separately, `ConverterService.detect()` called `stat()` and
never asked `isFile()`, so a directory opened to an empty sample and came back as
`detectedKind: text, sizeBytes: 0`; every non-regular entry is now refused before it is opened.
Proven red-then-green by reverting the two producers with the tests in place: 2 failed, then 2
passed on restore.

**Release documentation** (`d4fbc627`). `docs/ci-and-releases.md` claimed the workflow was
manual-dispatch-only with automatic publication disabled; `release.yml` actually declares both
`push: branches: [main]` and `workflow_dispatch`, and its own header says every push to `main`
releases. Corrected, with the 2026-08-15 tag-loop incident and its counts preserved as history
and the restoration recorded rather than the lesson deleted.

  The same lane **refused** the other half of its brief, correctly. This document had claimed
  `CLAUDE.md` still described `TabBar.tsx` as the drag region; `CLAUDE.md:2104` already says that
  file is deleted and that its job moved to `ProjectSwitcher`/`TopAppBar`. That claim was stale
  too, and is retracted here rather than acted on.

**Explorer drag and drop** (`d1b7da3a`) — a new feature, not a repair. Dropping an agent node on
an Explorer folder row opens a NEW agent of the same kind rooted there, leaving the dragged
session untouched; dragging a folder the other way onto empty canvas opens a terminal at the drop
point. A terminal's cwd is fixed at spawn, so spawning a sibling is the only honest way to open
in a folder without killing a session mid-turn, and the reverse direction is deliberately a
terminal because a folder drag carries no agent identity. Each direction uses its own namespaced
MIME type so neither collides with an OS file drop or the sessions-sidebar reorder drag. The agent
path goes through the branded launch-plan funnel under a new `explorer-drop-agent` row in
`AGENT_LAUNCH_SURFACES`, so `permissionMode.funnel.test.ts` now exercises it. SSH projects stamp
the remote cwd. Keyboard and context-menu equivalents ship with it.

### One guard corrected, and watched failing first

The new drop indicator is the first rule in `styles.css` to reference `var(--font-ui)`, and
`styles.theme.test.ts` went red. The guard was right by its own logic and wrong about the world:
that token is defined in `fonts.css`, which `boot.tsx` imports immediately *before* `styles.css`,
and `styles.md3.css` already uses it about seventy-five times. Its corpus was a single file.
`fonts.css`'s **definitions** are now merged in and nothing else — it carries no colours and no
theme blocks, so adding it to the literal-colour or theme-block corpora would have cost teeth for
nothing, and it does not define `--mono`, so the historical `.mc-console` defect stays catchable.
Verified by appending a genuinely undefined token: red, naming it; green again on removal.

### Suite state, stated honestly

Two full runs at effectively the same tree each reported **one** failure, and **a different one
each time** — `styles.theme.test.ts` in the first, `src/core/ollama/catalog-store.test.ts` in the
second. The Ollama file passes in isolation twice. Two different single failures across two runs
is nondeterminism under load rather than a deterministic regression, which is exactly the
contention shape this document already records elsewhere. Final measured figures: **709 files,
702 passed, 6 skipped; 8,925 tests, 8,732 passed, 192 skipped**, with the one contended failure
above. Typecheck clean, build exit 0.

### The status surface, and the capture it owed

`feat/status-hub-surface` was held out of `main` for one reason: no packaged capture of its own
screen. It has one now — `docs/assets/shots/app-status-surface.png`, taken from the real built
artifact driven over CDP **on an off-screen Win32 desktop**, so nothing appeared on anyone's
display while it ran. The manifest binds it to the exact commit rather than to "recently".
19 surfaces captured, 3 skipped for stated reasons, 0 failed.

**Three conflicts, and the third is the one worth reading.** `closeAllDrawers` existed twice —
`main` had grown a `useCallback` while the branch added an inline copy that shadowed it for every
call site below; collapsed to one definition now closing all eight drawers. `anyDrawerOpen` had to
become the union of both lists rather than either one. And the stylesheet conflict was git
mis-aligning two disjoint blocks (`.md3-docs*` against `.md3-status*`); resolving it by
concatenation broke brace balance because one hunk cut a rule in half, so it was redone by taking
`main`'s file whole and appending the branch's self-balanced 340-line block.

**Then the one that matters: the merge dropped `<StatusSurface />` entirely.** The import survived,
the rail destination survived, the `useState` survived, and **`tsc` passed** — a whole screen
reachable by a button that rendered nothing. It was found by grepping for the render site rather
than by trusting the green typecheck, and recovered from the branch rather than reinvented. This
is the identical shape this document already records under “the convergence dropped working
code”, and the identical warning that a clean typecheck is not evidence. It happened again, in
the same repository, to an agent that had just finished reading the warning.

The capture row is therefore **required**, not optional, and verifies `.md3-status-screen` — a
selector that exists only inside the component. The host div would not do: `Canvas` renders that
even when the component draws nothing, which is exactly the broken state that has to stay
catchable.

### Suite, re-measured clean

After the status surface merged, a full run came back **entirely green**: **711 files, 705 passed,
6 skipped; 8,959 tests, 8,767 passed, 192 skipped, 0 failed**, exit 0. That settles the two
single-failure runs recorded above as contention rather than regression — they are left in the
record anyway, because the honest version of “it passes now” includes the runs where it did not.

### The Windows packaged-capture row is blocked on a MISSING PROMOTION PATH, not on the capture

This was investigated properly rather than guessed at, and the answer is more useful than
“still pending”. Everything upstream of the last step is ready, verified by running commands:
the tree is clean, `HEAD` is byte-identical to the remote's `main` tip, the immutable icon is
publicly fetchable at that SHA (HTTP 200, 15633 bytes matching the committed blob), the
Spectre-mitigated MSVC libraries are installed, no process from this checkout holds a native
addon, and the cheap headless executable is exactly where the orchestrator demands it. A
purpose-built harness for precisely these four capture ids
(`windows-terminal-profile-picker` / `-terminal` / `-unavailable` / `-reattached`) has been
sitting unrun since `a4e3b13d`.

**The blocker is that the harness writes its evidence where the contract does not read.**
`run-windows-profile-packaged-acceptance.mjs` emits its manifest to the TASK ROOT, and it is the
only place in the tree carrying the required `cheap Lowlevel MCP headless` needle. The contract
reads `docs/assets/shots/capture-manifest.json` — a file `capture-shots.mjs` **regenerates
wholesale** on every run with a hard-coded `method: 'Electron + CDP ... out/ artifact'` and
`app-*` ids only. So a hand-merge is both unearned and self-erasing: the next `npm run shots`
deletes it. The generic promotion tooling the `promote-ui-evidence` skill assumes
(`scripts/stage-evidence.mjs`, `scripts/verify-evidence-receipt.mjs`) **does not exist in this
repository**.

That missing promotion path is the actual defect, and it is the thing to build. Either teach
`capture-shots.mjs` to MERGE a packaged-acceptance block rather than overwrite, or add a
promotion script that copies the PNGs in, verifies each against the SHA-256 the driver recorded,
and writes a manifest whose `method` names the cheap route. Whichever way, **`npm run shots` must
stop being able to erase it** — without that, the row can be made green once and will go red
again for reasons nobody will connect to the capture run.

Two further traps worth carrying, both found by reading the code rather than by running it:

- **Existing `dist/` artifacts can never be reused.** `createBuildProvenance` fails any artifact
  whose mtime predates the frozen source snapshot, so `npm run dist:win` must run AFTER the
  snapshot step, not before. `REQUIRED_ARTIFACT_ROLES` also demands the full Squirrel set exist
  and be hashed even though the run only ever launches `win-unpacked/nodeterm.exe`.
- **Flipping the status is a three-file change, not a one-liner.** The same feature row requires
  a docs needle matching `does not claim that the pending capture`, which is a real sentence in
  `windows-shell-profiles.md`. Marking captures verified while that sentence stands would be
  self-contradictory, so the article, the needle and the status must move together — and the
  acceptance manifest self-declares `acceptanceComplete: false` with `installer: blocked`, so
  closing the capture row must not be described as installed-artifact proof.

### An adversarial audit of this session's own merges found nothing

Two independent auditors were pointed at `289fcb47..HEAD` and told to assume it was broken —
one hunting code wired at one end and consumed at neither, the other hunting the merge-semantic
shapes this document already records (dropped symbols, silently merged same-named interfaces, a
guard whose scaffolding survived while its body did not). They raised **eleven** candidates.
Each faced two independent judges, one trying to refute it and one asking whether it would
matter even if real, with a finding surviving only if both agreed. **Zero survived.**

That is recorded as a result rather than skipped as a non-event. The `<StatusSurface />` drop
earlier the same day proved this repository can ship a clean typecheck over a missing screen, so
“we looked hard and found nothing” is worth exactly as much as a finding would have been — and
it is now the difference between an integration nobody re-checked and one that survived being
attacked.

### Still open

- **`fix/blur-scale-wiring`** (`f003a05d`) — the ONLY branch still out, and it is blocked on a
  person rather than on work. `CLAUDE.md` forbids shipping it without a device eyeball at zoom 1
  and at a fractional zoom, on each renderer, and no agent can supply that. It already contains
  all of `main`.
- **`feat/status-hub-surface` is now merged** (`05df0a4f`) — see below.
- The Windows terminal-profile contract row still owes packaged, cheap-headless capture evidence.
  `npm run shots` photographs the picker from the unpackaged `out/` build over plain CDP, which is
  deliberately filed under different ids and cannot half-satisfy the packaged row.
- **The addendum's "nobody has launched the built app and looked at it" is also retracted.**
  `docs/md3-render-verification.md` records exactly that work, done at `38280b0b` by launching the
  real built `out/` artifact in a real Electron process and driving it over CDP: `check:wired`
  reached 6/6, `npm run shots -- --launch` ran, and it found and fixed a real light-mode scrim
  defect. What that document itself still lists as unverified is the narrower set: OS-level window
  frame capture against a live HWND (CDP only sees an emulated viewport), the two surfaces needing
  a live agent CLI or a reachable SSH host, Roboto Mono's glyphs with a terminal actually open,
  and a light-theme sweep of every remaining dialog beyond the six selectors named. Neither
  `check:wired` nor `shots` was re-run in THIS pass, so those results bind to `38280b0b`, not to
  `main`.

---


## Release timing, dim-sum link, and Pages trigger repair

The release workflow now requires GitHub's run start time, records a post-publication completion
boundary, regenerates the same release body with exact start/completion/duration fields, and reads
the published body back for byte-equivalent text verification. Already-published retries validate
those fields and mutate nothing. Dim-sum prose links the catalog's published photo and explicitly
says it is not a consumer-release attachment. Pages now runs on every `main` push and manual
dispatch. Local build evidence does not prove the remote publication/deployment transaction; use
the exact workflow and Pages run links recorded for the final commit.

## Project-aware shell detection persistence repair

`ShellSection.refreshDetection` no longer writes `useSettings.getState().base` directly before
refreshing Windows terminal profiles. It passes the bounded effective active-project custom
executable to a read-only detector path instead, so sparse `defaultShell` and
`defaultTerminalProfileId` overrides remain project-owned and global `settings.json` is untouched.
`TerminalPreview` now reads effective Settings as well. The production Settings-source sweep found
no second direct `settings.save(base)` bypass. Build/package evidence belongs to the commit reported
for this section; no tests, lint, type checking, runtime interaction, installer execution, or
screenshots were performed in the ultra-speed lane.

The same lane repaired the pre-push identity checker to forward every revision argument supplied
by the hook. New-branch ranges now retain `--not --remotes`, so already-published placeholder
history is excluded without bypassing the hook or rewriting history; newly introduced reserved
addresses remain refused.

## 2026-08-19 runtime, project history, deployment and device-access pass

Three milestones were implemented and pushed to `main` during this session:

- `66163ba0` — automatic verified Temurin Java provisioning for managed Minecraft servers;
  mouse-wheel canvas zoom and empty-background drag panning defaults; per-project app-data Git
  history on successful saves; one-file `.nodeterm-project` export/import containing a Git bundle;
  and personal-vocabulary coverage for the worktree dialog while preserving paths, refs, typed
  values and raw Git errors.
- `d475bdee` — the top-right device shortcut now invokes the Server Edition deployment path,
  automatically obtains/starts Docker Desktop where possible, runs the validated host wrapper,
  builds the local image when absent, waits for health and offers the local site.
- `fd752f51` — rotating deployment TOTP login with persisted replay prevention; no payment checkout
  at the core IPC boundary; paid License/seat and upgrade surfaces removed; Remote Access presented
  as free; and phone-sized Server Edition layouts forced to the sessions/board experience with the
  Canvas destination omitted.

While the third milestone was being pushed, `origin/main` advanced through `976bc0a6`, including
project-wide settings and a bounded Docker-host runtime. A normal merge was started and the three
overlapping renderer conflicts were resolved in favor of the newer Docker-host/settings
implementation. Before finalizing the merge, rerun `npm run typecheck` and the focused suites below;
the pre-merge third-milestone verdict was green, but a verdict never transfers across a merge.

Focused evidence before that reconciliation:

- `npm run typecheck` — passed.
- Project/Java/canvas/settings/history/vocabulary suites — 150 tests passed.
- Deployment production build (`npm run build`) — passed at `d475bdee`.
- Server TOTP/auth/HTTP/license/mobile-view suites — 58 tests passed at `fd752f51`.

Important remaining boundaries:

- The deployed site is still advertised at loopback HTTP. Do not expose the application port on
  `0.0.0.0`; mobile reach needs the existing TLS/private-network route completed and verified.
- The TOTP secret is stored in `.nodeterm-server-totp`, excluded from Git, ACL-restricted by the
  deployment service and mounted read-only into the container. Verify the ACL and real container
  login in a fresh deployment before calling mobile pairing complete.
- `src/renderer/styles.css` contains an unrelated unstaged user/other-session change (monospace
  token alias and terminal background token). It was deliberately excluded from this session's
  commits and must be preserved.
- No real built-app UI capture or real Docker container interaction was completed for the third
  milestone after the concurrent merge.

This document records the measured repository state before the 2026-08-16 branch-convergence pass.
It is intentionally explicit about evidence that belongs to an older commit and work that remains
unintegrated. A passing check on one branch is not presented as proof for another branch. Treat
every branch, worktree, test, and release count as a dated snapshot and re-measure it after
convergence.

## Historical main baseline and blank-window fix

The aggregate side entered this merge with an earlier baseline at `effb73a3` on `main`, verified
against the public repository at that time. The version before it described `63722558`, 460 test
files, and 23 checkouts; all three figures had already become stale, which is why this handoff now
binds evidence to exact commits instead of presenting remembered counts as current.

A packaged release opened to a **completely blank window** with only the system window controls.
It was fixed on `main` in `effb73a3`; any replacement installer must be built from that commit or a
descendant that preserves the fix.

The cause is worth understanding because it will happen again if the mechanism is disturbed. The
Squirrel bootstrap imports the application graph lazily, so Rollup emits that graph as a *dynamic
chunk*. Vite's default `chunks/` directory moves it one level down — which silently relocates
`__dirname`. Every path anchored to it (preload, renderer HTML, HUD preload, HUD renderer, the
unpackaged icon) then resolves one directory off. **Nothing errors.** You get a window with no
preload bridge, which reads as a renderer failure and sends you looking in the wrong place entirely.

Two things hold it now, and both are needed: `chunkFileNames` pins the chunk beside the entry, and
`desktopBuildPaths()` refuses outright when it is not running from `out/main`, so a future config
change fails loudly at the boundary instead of shipping a blank page.

## What this project is now

nodeterm is a public BUSL-1.1 Electron/React spatial terminal manager. Persistent terminal and
agent sessions live as draggable nodes on a canvas and as cards on a kanban board. An
Electron-free core powers both the desktop shell and a Linux browser-based Server Edition;
terminal continuity uses tmux where available and a standalone Windows session host otherwise.
A separately maintained mobile companion connects through the relay protocol. The current
unpublished integration line combines Windows, persistence, pairing, scheduled-settings,
local-history, appearance, data-format, and relay hardening, but the branches listed below still
need to converge before it can replace `main`.

## Measured repository state

Snapshot time: `2026-08-16T17:03:02-04:00`.

| Item | Measured value |
|---|---|
| Integration branch | `fix/yum-tong-final` |
| Integration commit | `552362f243b86c341f2346c1c8cc791ce1229fff` |
| Integration working tree | clean and identical to `origin/fix/yum-tong-final` |
| `main` / `origin/main` | `c31683c630936b38c1734b15b2344c2c8317df44` |
| Integration divergence from `origin/main` | 81 commits ahead, 0 behind |
| Linked worktrees | 37 |
| Local branches | 39 |
| Stashes | 0 |
| Repository visibility | public |
| Repository issues | disabled |
| Release workflow | manually disabled (workflow ID `334756298`) |

All authored changes were committed and pushed to their owning branches by the end of the
preservation sweep. Two local-only items need special handling before their worktrees can be
removed:

- `material-nodeterm-pup-atomic` contains an untracked dependency/test cache under
  `.atomic-vitest-cache/tweetnacl/`. It is not project source and must not be committed as source.
- `material-nodeterm-pup-docker` contains an ignored local `.env` with a secret-like value. Its
  value was not read and it must never be committed or deleted implicitly.

The final branch/worktree counts must be regenerated after integration. The numbers above are a
snapshot, not deletion authorization.

## Earlier main-side changes carried into convergence

The aggregate side also carried these commit-bound changes into this merge. They are implementation
history, not proof that the final combined tree has passed its gates:

- **Blank release window** fixed (`effb73a3`) — described above.
- **Ordinary Windows terminal typing and agent-launch regressions** fixed (`1c305ec2`). The
  checkpoint had treated the default `auto` profile as an explicit request for the session host,
  whose fire-and-forget write path could drop input silently; it also advertised
  `pty.executeLaunchIntent` without a matching main-process handler.
- **All formerly paid features made free** (`66222613`). `isPremium` now follows the local
  `proFeaturesEnabled` performance switch, which defaults on; it is no longer a payment gate.
- **Personal-vocabulary upload compatibility** widened (`274f9920`) to accept `schemaVersion` or
  `version`, a `terms` list, and companion documents with no substitutions.
- **The 179-file Windows checkpoint** (`a4e3b13d`) preserved terminal-profile, session-host, and
  installer work that had existed only on disk. It was explicitly unverified at that checkpoint,
  and later repairs do not turn that old commit into verification evidence.

## Test inventory and evidence ledger

The current integration commit collects 527 test files. Of those, 522 contain 6,518 runnable
tests in the current Windows environment. This is a collection result, not a passing full-suite
result.

| Area | Active files | Runnable tests |
|---|---:|---:|
| `scripts` | 1 | 5 |
| `site/app` | 4 | 22 |
| `src/core` | 162 | 2,266 |
| `src/main` | 63 | 786 |
| `src/preload` | 1 | 8 |
| `src/renderer` | 205 | 2,535 |
| `src/server` | 17 | 165 |
| `src/session-host` | 4 | 13 |
| `src/shared` | 45 | 639 |
| `test/remote` | 9 | 49 |
| `test/server` | 11 | 30 |
| **Total active** | **522** | **6,518** |

Five collected files have no runnable case in the current Windows environment:

- `src/core/local-send-keys.realtmux.test.ts`
- `src/core/paste-injection.realtty.test.ts`
- `src/core/remote-ssh/control-master.realsh.test.ts`
- `src/renderer/lib/sessionRename.realtty.test.ts`
- `test/ssh-docker/askpass-e2e.test.ts`

The exact individual-file inventory is reproducible without running the tests:

```powershell
npx vitest list --filesOnly --json
npx vitest list --json
```

The evidence ledger is commit-bound:

| Evidence | Exact commit | Command or route | Result | What it proves |
|---|---|---|---|---|
| Last frozen full Windows suite | `f6d6d66e5093ae5f931cc8b131577cddcec61011` | `npm test -- --no-file-parallelism` | 515 passed / 5 skipped files; 6,419 passed / 166 skipped tests; 0 failed; 32.47 s | Source-tree unit and integration behavior at that commit |
| Frozen Windows inventory | `f6d6d66e5093ae5f931cc8b131577cddcec61011` | Vitest list commands above | 520 files, 515 active, 6,419 runnable | Collection only |
| Current inventory | `552362f243b86c341f2346c1c8cc791ce1229fff` | Vitest list commands above | 527 files, 522 active, 6,518 runnable | Collection only; not a green run |
| App contract | `552362f243b86c341f2346c1c8cc791ce1229fff` | `node scripts/check-app-contract.mjs` | 520/520 assertions across 44 features | Source/contract scan, not runtime interaction |
| Site contract | `552362f243b86c341f2346c1c8cc791ce1229fff` | `node scripts/check-site-contract.mjs` | 326/326 assertions | Source/contract scan, not runtime interaction |
| Vocabulary precondition | `552362f243b86c341f2346c1c8cc791ce1229fff` | `node scripts/check-vocabulary.mjs` | passed | Local build precondition |
| Last recorded built-app wiring | `63722558` | `npm run build && npm run check:wired` | 6/6 | Built `out/` artifact driven over CDP; stale for the integration line |
| Authoritative desktop captures | `b5815d21381bb8b578a09b2f7e4c1a98a815b325` | capture workflow | six real built-app captures; live-agent and SSH captures explicitly skipped | Built-artifact visual evidence, not behavior tests |
| Last Linux-host full suite | `c42d8ec196913296203a8b0ecad8e3060b8c6dfe` | isolated container test route | 488 passed / 2 skipped files; 6,423 passed / 21 skipped tests; 0 failed | Linux source/runtime evidence, not Windows package evidence |
| Public release workflow | `c42d8ec196913296203a8b0ecad8e3060b8c6dfe` | workflow run `31966413527` | build and publication passed | Packaging only; the workflow explicitly ran no tests, typecheck, or lint |

`npm test`, typechecking, and the contract scripts do not interact with an installed application.
Only `check:wired`, real captures, and a future installed-package exercise cross that boundary.
There is no exact-final built-artifact interaction result yet.

## Published baseline

The latest public release was verified through the GitHub API, the exact tag ref, and public asset
requests:

- Tag: `v0.3.0-ci.208`
- Target: `c42d8ec196913296203a8b0ecad8e3060b8c6dfe`
- Published: `2026-08-16T19:12:56Z`
- State: non-draft and non-prerelease
- All three asset requests followed redirects to HTTP 200

| Asset | Bytes | SHA-256 |
|---|---:|---|
| `node-terminal-0.3.0-full.nupkg` | 216,733,412 | `7e90eeb4b8fb6ef38c2b1e4ee37b6c25806df5da12c5b914a4b69ea4393d4a8e` |
| `nodeterm-Setup-0.3.0.exe` | 216,853,504 | `f3d30ccc7b62cf9bfcb56aca9f7e3ba5c3c2e2278ed82283bd129fc1dc7dd9cd` |
| `RELEASES` | 84 | `308012e562128a9c53b0234b5c22b0646e84e8ab8cdfc5806bc15b337210dc31` |

No newer release was created during this finish pass. The current integration manifest is still
`0.3.0`; the `0.4.0` updater work is on an unintegrated branch. The hosted Release workflow remains
manually disabled.

## Completed branches awaiting integration

These commits are pushed and their worktrees are clean, but they were not ancestors of the
integration branch when this handoff was written:

| Area | Branch | Exact commit | Branch-local evidence |
|---|---|---|---|
| Server authentication | `fix/yum-tong-server-auth` | `cade1d083fda385eba4acd9ef7720d70e1a46df8` | 184 server tests; 74 focused authentication tests; typecheck; Server build; 528 app-contract assertions; security re-review |
| Atomic credential transactions | `fix/yum-tong-atomic-reconcile` | `a2114fb421e83e25415aba930ce66d031a00c6c0` | 324 tests across 32 files; typecheck; three mutation classes; no full app/server build |
| Session-host ownership | `fix/hardening-session-client-final` | `12a1f9acc5e4a9e37a1b346de9fb224d48d45d3a` | 305 tests across 24 files; typecheck; full app build; mutation proofs |
| Kids/destructive safety | `fix/yum-tong-kids-final` | `11c2e5a79684fb6911614d3dfe1cdeb51af2d443` | 127 focused and 189 expanded tests; typecheck; full app build; 520 app-contract assertions |
| Updater checkpoint | `fix/yum-tong-updater` | `4becbe1127d07813bcf9f32eb25c7575c2148410` | 167 focused tests; typecheck; full app build; workflow checker; 326 site assertions |
| Windows build checkpoint | `fix/hardening-build-scripts` | `ee3c36c282a2f0ac82a904eabcdc78ca8dab3103` | 52 real `cmd.exe` BAT tests; 50 focused version/asset/icon tests; syntax, CRLF, manifest, and diff checks; full typecheck/build not rerun after scope freeze |

The updater and Windows build branches overlap in `package.json`, `package-lock.json`,
`.github/workflows/release.yml`, and `scripts/release-assets.mjs`. Integration must preserve the
legacy Squirrel package ID `node-terminal`, runtime AUMID
`com.squirrel.node-terminal.nodeterm`, version `0.4.0`, manual-main-only workflow, internal NuGet
identity checks, release manifest/digest checks, and the Windows asset/icon validations. Do not
enable `useAppIdAsId`.

## Known boundaries and unfinished work

No item in this section has an issue number in this repository because repository issues are
disabled. The list must be converted into tracked issues if issue tracking is enabled.

### Integration and verification

- The completed branches above need conflict-aware integration and ancestry proof.
- No full suite, typecheck, desktop build, Server build, built-app interaction run, package build,
  install, update, restart, or uninstall proof exists at the eventual final combined commit.
- The Release workflow is deliberately disabled.
- The updater still needs real packaged `0.3.0 -> 0.4.0` trials with the old app closed and running,
  plus disposable two-version restart/next-launch trials.
- The build checkpoint still lacks a static immutable `squirrelWindows.iconUrl`, hosted execution,
  final packaged icon inspection, and installed-app proof. Squirrel's `Update.exe` remains
  vendor-branded.

### Pairing and external companion

- The external companion source and release artifact were not available for verification. There
  is no combined proof that every `agent.json` writer uses the same cross-process lock or that the
  companion release implements the encrypted pairing/attempt-lifecycle contract.
- The public pairing helper is not a substitute for the separately maintained companion.

### Session, Kids mode, and process ownership

- Generic SSH termination and legacy tmux teardown remain best-effort outside the repaired
  standalone-session-host boundary. A missing node-pty `onExit` times out and leaves the generation
  claimed fail-closed.
- Kids-state watcher rearm/CAS behavior still has post-gap and external-writer races. Remote managed
  account deletion remains best-effort when the host is absent or disconnected. Core-conditional
  orphan-session killing and complete production delete-callsite inventory remain open.
- Session-host pipe ACLs have not received an independent security audit. Kids mode still lacks a
  real logged-in agent launch observation and child/adult usability validation.

### Server Edition and relay

- Server Edition canvas control is not wired.
- Server Edition context links are not initialized, and live session-title reads remain stubbed.
- Relay session-specific agent-status stores are not fed, so plain-shell lifecycle protection is
  incomplete.

### Agent and feature surfaces

- SSH worktrees and worktree-aware Explorer/command-palette indexing remain unsupported.
- Grok lacks context links, context metering, subagent activity, verified notification vocabulary,
  reliable remote naming, and verified canvas-control discovery.
- Gemini lacks transcript view support, Server context links/canvas control, remote title/meter
  support, and safe fallback for an invalid resume ID.
- Toy-lock node overlays, command-palette lock labels, and bulk creation remain unimplemented.
- Authenticator QR image/clipboard/camera import remains unimplemented.
- Bulk End sessions remains deliberately deferred.
- Ollama image attachments, exhaustive catalog metadata, regex search, copy-model UI, relay
  routing, and the stronger destructive gate remain incomplete.
- Site nested tab grouping remains unimplemented.
- ~~Material 3 elevation roles and migration of existing components remain unstarted.~~ **Stale
  as of 2026-08-19 — this line was wrong the moment it was written into this section and nobody
  caught it for three days.** The migration happened in full: the tab strip and dock were torn out
  and replaced with an M3 nav shell, both stylesheets were re-seeded to the M3 baseline, and the
  app now declares 46 M3 roles in both themes. See "Handoff addendum — the Material Design 3
  rewrite this file never recorded" at the end of this document for what shipped, what was
  verified, and what is still open.
- Speech native ABI/device proof remains incomplete, and the cloud transcription endpoint is not
  built.
- Session-memory macOS per-row comparison and a real memory-pressure signal remain open.
- The completeness scan cannot detect a feature that disappears together with its documentation.

The only live numbered external defect found during the audit is
`microsoft/node-pty#950`. In-code references to upstream issues `#29`, `#47`, `#84`, `#86`, `#87`,
and `#126` all point to closed issues and must not be used as current tracking for the boundaries
above.

## Issue handoff status

The repository is public but has issues disabled. `gh issue list` fails for that reason, and the
REST API returned no historical non-pull-request issues for this repository. Therefore the required
issue copy of this handoff could not be posted. This file remains the handoff of record until issue
tracking is enabled. Upstream PR #276 carries the earlier main-side handoff summary in its
description, but it is not a replacement for the newer commit-bound record here.

## Next-owner checklist

1. Integrate the completed branches above without dropping either side of shared contracts.
2. Re-run the full Windows suite, typecheck, desktop build, Server build, contract checks, and
   exact built-app interaction harness at the final combined commit.
3. Keep the Release workflow disabled until the manual-main-only workflow and package provenance
   checks are on `main`.
4. Produce the missing installed-package, update, restart, uninstall, and icon evidence before
   claiming release readiness.
5. Resolve or explicitly retain the external-companion blocker.
6. Refresh this document again after integration and verification; remeasure every worktree,
   branch, and ancestry claim before any cleanup.

---

## Post-convergence session (main `51bd89c5`)

Everything below was measured at that commit, after the branch convergence recorded above. `main`
is clean, identical to the remote, and typechecks on both `tsconfig.web.json` and
`tsconfig.node.json`.

### The convergence dropped working code — three shapes, all found after it landed

A bulk merge of long-diverged branches produced commits that are textually clean and had silently
discarded code. It is worth knowing the shapes, because each looked like success:

1. **Dropped symbols.** `transport`, `claudeLaunchCommand`, `liveCanvasOwnsProject`,
   `gitRemovalFingerprint` and others existed in parent commits and were simply gone. `main` failed
   `tsc` with **77 errors**. Each was recovered from history with `git log -S`, not reinvented.
2. **Duplicate same-named interfaces.** Two branches each added a `GitWorktreeRemovalProof`.
   TypeScript *merges* same-named interfaces rather than rejecting them, so the effective type
   became the union of both and every producer of either shape failed at once — with errors pointing
   at the producers, not the duplicate. They were different facts and are now
   `GitWorktreeRemovalMeasurement` (a measurement) and `GitWorktreeRemovalProof` (an authorization).
   `AuthenticatorEntry.revision` had the identical collision.
3. **A destructive safety barrier, gutted.** `beginApprovedRemove` (removing a Claude account) lost
   its `cancelWaitLogin` await and the `finalCommit` barrier that re-reads live state and re-checks
   Kids-mode policy **after** that await. Two branches rewrote it from one parent; the
   reconciliation kept the hardened version's outer scaffolding and the shallow version's inner
   body, so the guard read as present and was not. Its own tests were failing and had been dismissed
   once as environment noise. Restored from `11c2e5a7`; 9/9 pass.

**Typecheck passing is not evidence tests pass.** All three survived a green typecheck.

### Fixed this session

- Blank packaged window (`effb73a3`), Windows terminal typing + agent launch (`1c305ec2`).
- Kids **and** School mode could be ON with no PIN ever set and then never turned off — the mode
  record is shared across apps while the credential is a separate file, so "enabled with no
  credential" is reachable. Both now disable freely when no credential exists; an *unreadable*
  credential still keeps the mode locked, and now says it could not be checked rather than claiming
  the PIN was wrong.
- All formerly paid features are free; the remaining switch is a performance control with
  per-feature sub-switches. Master off → back on restores each feature's own choice.
- Client-side refusal of solicitation announcements (stars/donation/upgrade), which a server-side
  feed edit cannot undo. Security, breaking-change and mandatory-update messages are never filtered,
  including messages carrying both.
- Ollama's `not-installed` state was unreachable: the classifier text-matched `econnrefused` against
  an error message, but Node's fetch collapses these to `"fetch failed"` and the real code lives on
  `.cause.code`. Every "not running" case rendered "Ollama answered but reported a problem" when it
  had never answered.
- Tailscale sidecar behind its own compose profile, off by default, no published ports.
- Issue #128 (welcome screen could strand you) and #119 (lead-pane width, wired end to end).

### Upstream PR status

Already present via convergence or the concurrent session: **#112 #189 #113 #156 #175 #177 #275
#274 #273**. Integrated here: **#267** focus mode (`7fef4719`), and from **#111** only
`a60371d9` (PSReadLine Ctrl-C abort, `51bd89c5`).

Three deliberate exclusions, with reasons — do not "finish" these without revisiting the reasoning:

- **#111 psmux discovery — implemented on `feat/program-64-psmux-discovery`.** The resolver now
  checks `tmux` then the tmux-compatible `psmux` executable through Windows `PATHEXT`, and the
  missing-multiplexer banner offers the exact Windows Package Manager install action when it is
  available. The standalone Windows session host remains the fallback when neither executable is
  installed. PR #111's **NSIS packaging commit `daecb26e` remains excluded permanently** because
  Squirrel is the only Windows installer path here.
- **#98 — skipped, superseded.** `main` has `send`/`reply`/`status` persistent inter-agent messaging
  with authenticated routes and safe-turn-boundary delivery; #98's `notify` is a weaker fixed-prompt
  predecessor of it.

## 2026-08-27, Program 57 linked-agent inbox documentation lane

Issue #68 records the upstream PR #98 linked-agent notification request. The current default source
already carries the stronger successor implementation: `notify --node <id>` is app-authored and
fixed in `src/shared/agents/agent-messaging.ts`, substituted in the main process, and routed through
the verified `send`/`reply` delivery service. Project capability consent lives in the shared
`agentMessaging` registry, runtime pane ownership is rechecked, and permitted busy targets use the
bounded deliver-on-idle queue with FIFO ordering, 16-entry capacity, five-minute expiry, sender
outcomes, and trace records. The relevant source history is `4aefbfbd`, with the upstream design and
prototype preserved by links to commits `43f58420` and `8d3b00b3` in
`docs/features/agents/linked-agent-inbox-notifications.md`.

This lane added the per-feature article, category index link, generated offline documentation bundle
input, Pages article and index link, site documentation list, site and app completeness inventory
rows, changelog entry, and roadmap record. The implementation is desktop-only; Server Edition
returns its explicit unsupported result, and portable project files omit runtime queues, credentials,
machine paths, process state, and pane ownership records. No tests, type checks, lint, reviews,
security or accessibility checks, builds, packaging, installer execution, runtime interaction, or
UI captures were run under the issue's explicit ultra-speed boundary. Integration into `main`, the
default-branch merge and push, remote verification, and any release proof remain the parent lane's
responsibility.
- **#149 configurable shortcuts — NOT DONE.** A 9-file architectural change replacing the hardcoded
  shortcut rows with a registry driven from `settings.shortcuts`, colliding with the focus-mode
  binding added in `7fef4719`. Cherry-pick aborted cleanly rather than half-merged. This is the
  largest outstanding piece of work.

### Still outstanding

- **The full suite has not been run this session.** Typecheck is clean; that is all. Given what the
  convergence dropped, a real run belongs before any release.
- #149 above; issue #145 (annotation tools).
- Issue #42 needs an honest reply rather than a fix: `SUBAGENT_CAPABLE` is claude-only, so opencode
  subagent cards are unimplemented, not broken. #78 is a contributor's own roadmap — reply only.
- A design-comparison app for the Material Design overhaul was started at
  `C:/Users/cntow/Documents/GitHub/nodeterm-design-compare` and is incomplete.

### Full suite — RUN, and it is not green

Run at `7fc7ab9b`, serially (`npm test -- --no-file-parallelism`), 597 s:

| | |
|---|---|
| Test files | **42 failed**, 595 passed, 6 skipped (643) |
| Tests | **141 failed**, 7,842 passed, 182 skipped (8,165) |

This is the run that had been missing all session. Typecheck was clean throughout; it proved
nothing about these.

**Two causes account for most of it, and only one is a code defect.**

1. **A missing build artifact, not a regression.** Many failures were simply
   `session-host bundle not found (out/session-host/host.cjs is missing)`. Running
   `npm run host:build` produces it in 20 ms. Anyone reading a red suite here should build first
   and re-measure before diagnosing — but note this did NOT clear them all.

2. **A real protocol-compatibility defect, ~58 failures across five session-host files.**
   `session-host-client.ts` rejects a handshake with
   `session-host protocol publication disagrees with hello: state=2, hello=1`.

   The check is `identity.state.protocolVersion !== negotiated`, and those two values are not the
   same kind of thing:
   - `identity.state.protocolVersion` is what the HOST SUPPORTS — the host always publishes
     `currentProtocolVersion()` (2) into its state file.
   - `negotiated` is what THIS CONNECTION settled on — 1 whenever the hello reply omits
     `result.protocolVersion`, which is precisely the host's deliberate legacy path
     (`clientProtocolVersion === 1` for a client that requested 1 or nothing).

   So a current client meeting a host behaving as v1 legitimately yields `state=2, hello=1`, and
   strict equality refuses a combination the design explicitly supports. The failing tests assert
   that backward-compatibility path works. Comparing compatibility (state must be >= negotiated)
   rather than equality is the likely correct fix, but it was NOT applied here: changing handshake
   logic in the Windows persistence path deserves a careful, verified change rather than a
   plausible-looking one, and this session had no capacity left to verify it properly.

   `src/core/session-host-client.ts` was last touched by the convergence merge (`ba819a66`) and by
   the type-error repair (`3730b49f`); the convergence is the prime suspect, since it merged two
   protocol lineages.

**Do not treat 141 as 141 broken behaviours.** Failures cluster hard: 34 in
`session-host-client.test.ts` alone, and the counts above are per-assertion, not per-defect.

---

# Handoff — 2026-08-18, release candidate 0.4.3

Everything above this line is a **dated snapshot of the 2026-08-16 convergence** and several of its
figures are now stale — the 141-failure count in particular. It is kept because its *reasoning*
still holds (especially the blank-window mechanism), not because its numbers do. This section
supersedes its counts.

## The full suite has now actually been run

It had never been run in the convergence session. Serialized, on Windows, at `bfb0ba0f`:

```
EXIT=1    Test Files  30 failed | 614 passed | 6 skipped (650)
          Tests       56 failed | 8022 passed | 193 skipped (8271)
```

Two things about that run are worth carrying forward:

- **The wrapper reported exit 0 while vitest exited 1.** Capture `EXIT=$?` *inside* the log; a
  wrapper's status is the status of whatever ran last, which is usually `tail`.
- A concurrent lane mutated `workspace.test.ts` mid-run, so that file's verdict in this run is
  about a tree that no longer exists. It was re-run alone afterwards: 166/166.

## Blank window: measured, not inferred

`check:wired` passes **6/6 against the real packaged output** at `9facfc5f` — including "the canvas
renders real nodes, not a picture of nodes", "a terminal actually spawns" (`pty.create`
round-tripped), and 70 bridge namespaces answering a live main-process call. `out/main/` is flat
(`index.js` + one hashed chunk, no `chunks/` directory), so the mechanism described above is intact
in the artifact and not merely in the config.

Getting there needed two unrelated repairs, both worth knowing:

- The gate's "did boot create its managed artefacts?" list was derived from `managedConfigTargets`,
  which answers a **different question** — it is an allowlist of files bootstrap is *allowed* to
  touch, fingerprinted elsewhere to prove the real home came back unchanged, where `absent` is a
  fine answer. `ad3354e0` added the four shared School/Kids records to it for the capture harness;
  boot does not write those by design (`shared-record-watch.ts` exists precisely because that
  directory may be absent). Correct for one question, silently wrong for the other. Now split:
  `bootCreatedConfigTargets`.
- `node_modules/electron/dist` was empty with no `path.txt`. CLAUDE.md records `install.js` as a
  dead end that exits 0 having extracted nothing — that was measured on **Node 26.5**. On Node 24 it
  works. The dead end is version-specific, not absolute.

## Three coupled Codex identity defects, fixed in `7207a9e9`

Found by a seven-lane review, each verified from source before being believed. All three are the
same drift: the capability moved to the canonical `kid.mac` shape and three consumers stayed on the
old bare MAC.

1. `hook-server` minted and verified with `HMAC(secret, nodeId)` — no kid, no domain separation —
   while the only token a client can obtain is the `kid.mac` one in its token file. **Every
   `/codex-thread/*` route answered 403 to a correctly-tokened caller.** The secret was identical
   throughout: `setNodeAuthSecret` and `setCodexNodeAuthSecret` write one field.
2. The relay daemon's `register()` read `$NODETERM_CODEX_NODE_TOKEN`, which the launcher
   deliberately never sets (it pipes the capability on **stdin** and says so in a comment directly
   above the call). Now reads stdin, bounded.
3. `SAFE_NODE_TOKEN` pinned the old 43-char bare MAC with no dot, so even an arriving token failed.

The test that should have caught this asserted a **regex on the shape**, which is exactly how the
drift survived. It now asserts that what the server mints must verify; reintroducing the old
derivation turns three tests red, checked rather than assumed.

## Corrections to earlier claims

- **CLAUDE.md was wrong about the session reaper.** It promised only *detached* sessions are reaped.
  `session-budget.ts` removed that rule on purpose — 54 of 54 sessions on a real host reported
  attached, so the reaper had never fired — and activity staleness now carries the protection alone
  (grace defaults to a day). An idle session **is** reaped while attached. Corrected in place.
- **`package-lock.json` was briefly damaged and reverted.** An `npm install --no-save` dropped
  monaco's exact-pinned `dompurify@3.4.8`, leaving the hoisted `3.4.13` to satisfy it — silently, in
  a sanitizer, on every clean `npm ci`. Re-verify the lock after any ad-hoc install, not only at the
  moment you run one.

## Remaining known failures

Reduced but not zero. The residue is overwhelmingly **fixtures asserting the platform they run on**,
not application code the packaged app reaches. Each surviving skip names its exact environment
limitation and cites precedent `99dfb2db`; none is a blanket platform skip.

Two deliberate non-fixes, both recorded rather than papered over:

- Six `codex-identity-proxy` tests set `$NODETERM_CODEX_NODE_TOKEN` directly, which
  `codex-identity-proxy.ts` says explicitly does not exist as a fallback — search its launcher
  script for "deliberately NO". They test removed behaviour and are platform-independent.
- The `state=2, hello=1` handshake question raised above is **closed, and the fix it proposed was
  wrong.** That entry suggested comparing compatibility (`state >= negotiated`) rather than
  equality, on the theory that "a current client meeting a host behaving as v1 legitimately yields
  state=2, hello=1, and strict equality refuses a combination the design explicitly supports."

  The premise does not hold. Read in the source rather than reasoned about:

  - **The host writes its own state file**, with its own pid and
    `protocolVersion: currentProtocolVersion()` (`session-host/host.ts`, the publication just after
    the token file is written). State and behaviour therefore come from one process and cannot
    disagree for a host that is actually alive.
  - **The host omits `protocolVersion` from its hello reply only when the CLIENT asked for v1** —
    its branch is `clientProtocolVersion === 1`, set when the request carries version 1 or none.
  - **The client always asks for v2**: it sends `protocolVersion: SESSION_HOST_PROTOCOL_VERSION`,
    which is 2.

  So a current client reaching a live v2 host always negotiates 2 against a state that says 2. The
  only way to reach `state=2, hello=1` is a **stale state file** describing a dead v2 host while the
  socket is answered by something behaving as v1 — which is precisely an inconsistent host, and is
  what `session-host-client.test.ts` already says the refusal is for in as many words.

  Relaxing the comparison would accept that state and then run v1 semantics while trusting a state
  file the client reads v2 facts from, including the generation bookkeeping. The strict equality
  stays. **No change was needed; what was needed was reading the host's own publication path.**

## Solved: the fixture directory that outlived the Server Edition shutdown test

`test/server/server-e2e.test.ts` intermittently could not remove its own temp directory on Windows,
failing with `EPERM` on the directory itself — in teardown, after every assertion about shutdown
ordering had already passed. The measurements taken at the time are still the interesting part,
because they ruled out the obvious fix:

| bounded retry | failure rate |
|---|---|
| 1 s (20 x 50 ms) — what was there | ~1 run in 4 |
| 5 s | ~1 run in 6 |

The conclusion drawn from that was right — a holder surviving five seconds is not transient lag, so
buying more time is the wrong fix — and the longer wait was reverted, with the failure downgraded to
a warning so teardown could not decide a passing test's verdict.

**The missing step was WHY more time could never work.** `fs.rmSync`'s retries are SYNCHRONOUS:
they block the event loop, so they cannot let in-flight async work in the same process finish and
release what it holds. The retry loop was waiting for the thing it was itself preventing. The
holder is a mirror publication that opens `agent-status.json.publication.sqlite3` under this very
dataDir inside a `BEGIN IMMEDIATE` transaction, with nothing awaiting the flush.

Same options, same retry count, one keyword — `await fs.promises.rm`. Four consecutive runs, four
fixtures created and all four removed, zero warnings, and the leftover count in TEMP flat rather
than climbing. The warning stays as a net; it should now be silent.

Two further leaks in the same file's neighbourhood turned out to be production bugs and are written
up under the temp-directory leak section below.

## Open: eight commits on `main` carry a placeholder identity

`4ff914b1`, `5802bf16`, `e28e4321`, `fadb0843`, then `a3d28e75`, `1693b82a`, `69d2db23` and
`4a5596f6` (2026-08-17) are authored **and** committed by `Smoke User <smoke@example.invalid>`
with no `Co-Authored-By` trailer. A harness left an identity configured and pushed real work under
it, including `src/renderer/state/workspace.ts`, `src/core/speech/speech-service.ts`,
`src/renderer/components/ContextMenu.tsx`, `.github/workflows/release.yml`, `CLAUDE.md`,
`CONTRIBUTING.md` and `AGENTS.md`.

It is not cosmetic, and the size is measured rather than estimated: at `4a5596f6`, **1,256
surviving lines** were being credited to a person who does not exist. `scripts/count-lines.mjs`
attributed a line to an agent when the author matched a known automation identity **or** the body
carried such a trailer, and to a **person** otherwise — and a placeholder matches neither. `git
blame` also answers with an address that by definition cannot receive mail.

**The miscount is fixed; the history is not.** The counter now routes a line whose author sits on
a reserved, un-routable domain to `unknown` — the bucket that already means "nobody can be
credited for this" — instead of to a person. Proved by an A/B at one ref rather than asserted:
person 57,297 -> 56,041, unknown 0 -> 1,256, agent unchanged at 339,078. The arithmetic agrees
with itself. The published `rule:` sentence was updated in the same change, because a rule that
describes behaviour the code no longer has is worse than no rule.

Correcting the commits themselves means rewriting published history, which is a force-push, which
needs the branch owner’s explicit say-so and is never an agent’s call — least of all to tidy
something up.

**Recurrence is reduced, NOT blocked — do not read the guard as more than it is.**
`scripts/check-commit-identity.mjs` is wired into `.githooks/pre-push` and refuses a push carrying
an author or committer at a domain RFC 2606 / RFC 6761 reserve so it can never resolve. It checks
only the commits actually being sent, so what is already published is not its business, and it
deliberately does not enforce "one identity" — this history legitimately carries several real
people, and a check demanding a single name would refuse their work.

What it cannot do was demonstrated 31 seconds after it landed: four more placeholder commits
reached `main` from a parallel session, rebased onto the guard commit itself. A pre-push hook
binds one checkout that has opted into `core.hooksPath`; it binds no separate clone, and
`--no-verify` walks past it. The enforcement point that would actually hold is a server-side
check, and this project deliberately runs no gating checks in Actions (see
`docs/ci-and-releases.md`), so that is a decision for the repository owner rather than something
to quietly add. Until then the guard is a good local habit, not a boundary.

Verified in both directions rather than assumed: it flags exactly those eight and nothing else
across 300 commits containing five real contributors’ addresses, it refuses a simulated push that
would carry them, an ordinary push with nothing new to send passes, and breaking the matcher turns
`scripts/reserved-identity.test.mjs` red (3 of 7) before restoring it turns it green.

## Open: stranded draft releases, and what they cost

`v0.4.4` and `v0.4.5` are drafts left behind by failed release runs on 2026-08-18. `v0.4.6` and
`v0.4.7` published normally, so nothing is broken — but each stranded draft permanently occupies a
version number, because the planner reads `repos/:owner/:repo/releases`, which includes drafts, and
a number a draft holds cannot be reused without colliding.

**A re-run no longer strands another one.** `planReleaseVersion` always had a `retry` outcome for
exactly this ("bumping would strand the half-staged draft under a number nobody can find"), but it
required `packageVersion === highest.version` — and the every-push-releases design writes the
computed version into the working tree and deliberately never commits it, so `package.json`
permanently lags whatever shipped. The branch was unreachable by construction: measured at
`4a5596f6`, a re-run **at the same commit** planned `0.4.6` rather than resuming the `0.4.5` draft
sitting right there. It now also retries when the highest version exists ONLY as a draft targeting
this exact commit, which is the same claim the original condition was trying to make.

Four cases pinned, because the failure modes point opposite ways: same commit resumes its own
draft; a draft belonging to ANOTHER commit is refused and bumped past; no drafts bumps normally; a
hand-bumped `package.json` is still respected. Anything that cannot be PROVEN to be a draft counts
as published — the conservative direction mints a new number, the careless one would resume
something already shipped.

**The two existing drafts are not cleaned up here.** Deleting a release is outward-facing and
irreversible, and these are not obviously disposable: they are the only record of what those runs
staged. Removing them would also free their numbers for reuse, which is the one thing the version
rules exist to prevent. That is a call for whoever owns the repository, and either answer is
defensible — the reason to raise it at all is that nothing else will, and a draft list that only
grows eventually makes the release page unreadable.

## The full suite is green; a full run under load is not, and the difference is measurable

Run on 2026-08-18 while release builds, a parallel session and an agent fleet were all active:
**13 failures across 7 files** out of 8,405 tests. Re-run one file at a time, sequentially, on the
same tree at the same commit: **106 tests, 0 failures** — every one of the seven passed completely.

That alone would be suggestive. What settles it is that **not one of the thirteen computed a wrong
answer.** Five were vitest timeouts (four at 30,000 ms, one at a per-test 15,000 ms). The rest look
like assertion failures and are not: `expected Error: spawnSync C:\WINDOWS\system32\cmd.exe
ETIMEDOUT to be undefined`, and `expected { status: null } to deeply equal { status: 0 }` — a
`null` exit status is a process that was killed rather than one that returned the wrong code. Every
failure is "this took too long", none is "this is wrong".

That also rules out the other candidate. Cross-file interference through shared state is a real bug
class and running a file alone hides it too — but it produces wrong VALUES, not timeouts. Nothing
here produced a wrong value.

The run's own numbers say the same: 505 s wall clock against 2,613 s of test time and 898 s of
`import`, i.e. heavy worker parallelism on a machine that had none to spare.

**Do not respond to this by raising timeouts.** The 30 s ceiling was set from this repository's own
recorded guidance and is already six times the previous default; four tests exceeded even that, and
inflating it further would only hide the next genuine hang. The right responses are to run the full
suite when the machine is quiet, and — when a suite must run during a busy session — to re-run any
timeout-shaped failure in isolation before attributing it to anything. A verdict from a contended
run is a verdict about the machine, not about the code.

## Solved: the handlers-test flake was a synchronous retry waiting on async work

`src/server/handlers/index.test.ts` failed intermittently — between 1-in-4 and 4-in-6 on one tree
within an hour — always `EPERM` on removing its temp directory. It is fixed, and the cause
generalises well beyond this file.

**A mirror publication holds a SQLite lock inside the directory, and nothing awaits it.** The test
points `userDataDir` at the same temp repo it deletes. `withPublicationLock` opens
`agent-status.json.publication.sqlite3` under that directory inside a `BEGIN IMMEDIATE`
transaction; the flush is not awaited by the test, so it can still be in flight when `afterEach`
removes the directory. The `-journal` file sitting beside the database at failure time is what
proves the transaction was open, not merely that the file existed.

**`fs.rmSync`'s retries cannot help here, and that is the transferable part.** They are
SYNCHRONOUS: they block the event loop, so they can never let in-flight async work in the same
process finish and release what it holds. A synchronous retry loop waits for something it is itself
preventing. Switching that one cleanup to an awaited `fs.promises.rm` — same options, same retry
count — took it from 2-to-4 failures per 6 runs to 8 of 8, then 6 of 6 for the whole file.

**Two earlier published claims were measurement artifacts, and both are corrected.**

- "No individual file is locked, so the directory handle is busy" was a FALSE NEGATIVE. The scan
  opened each file for append, and SQLite's byte-range locks do not block that open, so the one
  file that mattered reported clean.
- "Never released, even after 60 seconds" was caused by the probe. The wait was a busy spin, which
  blocks the event loop — the same mistake as the retries, made while investigating the retries.

Five hypotheses were eliminated before the right question got asked, and the question that finally
answered it was cheap: *what is still in the directory after the removal fails?* Two filenames.
Ask what remains before asking who is to blame.

### Not swept: the 209 synchronous retries added the same day

The retry sweep added `maxRetries` to synchronous `rmSync` calls across 141 files. That is still
correct for the case it targets — a handle held by ANOTHER process, such as the virus scanner —
because the event loop is irrelevant there. It cannot fix a hold owned by pending async work in the
same process, which is what this file had. Converting those call sites to awaited `fs.promises.rm`
would require making each `afterEach` async and is a larger, separate change; the ones that matter
are the tests whose subject writes under a directory the test then deletes.

## Solved: the temp-directory leak, and the bug class behind it

A full suite run used to leave dozens of `nt-*` directories in TEMP — 387 had accumulated. A full
run now leaks **one**, and that one is `nt-tui-`, which is out of scope by standing instruction.

The leak was not untidy tests. It was two production paths caching a PER-RUN directory in a module
singleton and never clearing it, so a server started after a close wrote its files into the
PREVIOUS run's data directory — recreating a directory the test had correctly deleted:

- `hook-server.ts` — `endpointPath` is resolved lazily from `platform().userDataDir` and memoized.
  `stop()` cleared `server`, `port` and `token`, every other per-run field, and missed this one. A
  restarted server advertised its live endpoint and token into a stale path, while the directory
  that should have held them had none.
- `context-link.ts` — `contextLinkDir()` memoized the same way, so a second server's link files
  landed in the first server's directory. The cache is removed rather than cleared on stop: it
  saved one `path.join` across five call sites, none hot, and a value that must be invalidated is a
  value better not stored.

Benign on the desktop, which runs one of each for the life of the process. Not benign for the
Server Edition, whose `close()` is a real repeated operation.

**A third candidate was checked and is fine.** `agent-status-mirror.ts` has the same lazy shape in
`resolveFile()`, but `initAgentStatusMirror()` is called from each shell on start and assigns
unconditionally, so a second server re-points it correctly. Written down because the pattern looks
identical and the next person will find it and want to "fix" it too.

### How it was found, which is the reusable part

Not by reading. The test leaked exactly one directory per run, and the first test's `dataDir` was
deleted correctly — `existsSync` said false — and then reappeared. From there it was subtraction:
fix one writer, look at what the survivor still contains. `hook-endpoint.env` disappeared and
`context-links/context.sh` remained, which named the second cache without any guessing.

Ask what is IN the leftover, then remove writers one at a time. Both of tonight's directory
mysteries — this one and the EPERM flake — gave themselves up to that same question, after five
hypotheses between them had failed.
---

## Handoff addendum — the Material Design 3 rewrite this file never recorded (2026-08-19)

### Why this section exists

`HANDOFF.md` is the handoff of record for this repository, and until this section was added it
contained **zero** occurrences of "Material Design 3", "MD3", "NavRail", "TopAppBar",
"styles.md3", or "TabBar.tsx" — confirmed with a plain `grep`, not assumed. The largest change to
this app's UI in its history — every stock chrome surface torn out and replaced — happened
entirely underneath a document that kept describing an app whose tab strip and dock still existed.
A handoff that is confidently wrong about the biggest recent change is worse than no handoff at
all, because the next reader trusts it. Every claim below was checked against the tree at commit
`38280b0b7d3d7a22641464984225c07c4df833f8` (this worktree's `HEAD`, and `origin/main`'s tip at
write time) before being written down; none of it is restated from the brief that asked for this
correction.

### What actually shipped

The rewrite spans roughly twenty commits landing 2026-08-18 (`git log --oneline -- design/v2/`
and `-- src/renderer/styles.md3.css` both bottom out that day), starting from
`84ef6d14 feat(design): apply the M3 roles to the low-risk surfaces` and running through
`41a593eb feat(tools): Ollama, converter, authenticator and toy locks get the M3 seed`. It is
fully merged into `main` — not stranded on a branch — via `main`'s own first-parent chain
(`db0c00ed Merge branch 'feat/minecraft-server-manage'` and `7c922e70 fix(md3): rebuild the M3
sheet from its lanes, and let the bar be 64` both sit on that chain, ahead of the
Docker-hosted-deployment commits `d475bdee`/`fd752f51` at the very tip).

**The tab strip and bottom dock are gone.** `src/renderer/components/TabBar.tsx` and `Dock.tsx`
were deleted outright in `b4061448 feat(shell): wire the app to the nav shell; retire the tab
strip and dock`. In their place: `TopAppBar.tsx` (51 lines — a flat 64px surface-container bar
that is also the window drag region), `ProjectSwitcher.tsx` (799 lines — a menu button replacing
the project tab strip: one dropdown lists every project, drag-reorders them, and expands a
per-project actions panel carrying everything the old tab caret menu did, including the
session-duration toy-lock relock effect, which moved here so it could never go missing), `NavRail`
(81 lines — an 88px rail that is a real flex sibling of the canvas, not a floating overlay, with
Canvas/Board/Files/Tools/Alerts/Settings destinations and Kids pinned to the bottom), and
`FabMenu.tsx` (350 lines — the "add a node" dropdown, the old dock menu moved here verbatim). The
floating `.controls-cluster` is gone entirely too: search, the presence facepile, notifications,
phone pairing and help moved into the app bar; Explorer/Source Control/the file converter/the
Ollama manager are now reached through the rail's Files/Tools destinations. **`CLAUDE.md` itself
was not fully updated for this** — as of this writing it still says, in its own "Window chrome"
section, that "the tab bar (`TabBar.tsx`) is the drag region" (`CLAUDE.md:2060`), a file that no
longer exists. That correction belongs to whoever next touches that file; it is out of scope for
this pass, which only writes `HANDOFF.md`.

**The app bar is 64px, the rail is 88px.** `--app-bar-h: 64px` and `--nav-rail-w: 88px` are
declared at `src/renderer/styles.css:100-101`; every floating panel/overlay that positions itself
below the bar does so via `calc(var(--app-bar-h) + …)`. `src/shared/layout.ts` exports
`APP_BAR_HEIGHT = 64` as main's independent copy of the same number (the file's own doc comment
says outright that the two have no shared build-time link and must be changed together), consumed
by `src/main/index.ts:569` for the Windows `titleBarOverlay` height so the native caption-button
overlay lines up with the app bar instead of floating over the canvas below it.

**There are now two stylesheets.** `src/renderer/styles.css` (14,569 lines — the pre-existing
token layer plus legacy rules) and `src/renderer/styles.md3.css` (8,414 lines — the new chrome),
the second imported immediately after the first in `src/renderer/boot.tsx` (`import
'./styles.css'` then `import './styles.md3.css'`) so it wins on source order wherever the two
declare the same selector.

**Three font families ship as committed, subsetted `.woff2` under
`src/renderer/assets/fonts/`** — `material-symbols/material-symbols-rounded-subset.woff2` (one
file), `outfit/` (two variable-weight files, latin and latin-ext), `roboto-mono/` (four files:
400/700 × normal/italic) — seven files total, all tracked in Git (`git ls-files` confirms none are
gitignored). `scripts/build-fonts.mjs` regenerates them and also emits
`src/renderer/components/materialSymbols.generated.ts`, a generated name union consumed by
`MaterialSymbol.tsx`. Material Symbols is subset **by codepoint, not by ligature name**: the
component renders the glyph's raw private-use-area character directly, never the ligature text,
because the subset was built with GSUB/ligature substitutions stripped — confirmed by reading both
`build-fonts.mjs`'s own comments and `MaterialSymbol.tsx`'s doc comment, which say this in nearly
identical words.

**The token layer was re-seeded to the M3 baseline, and the default accent changed.**
`DEFAULT_ACCENT = '#6750a4'` (`src/shared/types.ts:1655`) replaced the prior default of systemBlue
`#0a84ff`. This is a real, user-visible appearance change for every existing install, and
`src/core/settings-store.ts` carries an explicit one-time migration for it (its own comment and
guard, lines 53-63): because the app always persists the full settings object including untouched
defaults,
every existing `settings.json` has `#0a84ff` written in byte-for-byte — indistinguishable from a
user who deliberately chose systemBlue — so the migration treats the old literal default as "never
touched" and carries it forward to the new default once. A user who genuinely wanted systemBlue
loses that choice on first launch after upgrade and has to re-pick it from the swatch row. The
same migration also flips two canvas interaction defaults (`wheelZoom`/`canvasDragMode`) forward
for anyone still on the old literal defaults.

**New surfaces that did not exist before this window, confirmed present:** a changelog viewer
(`src/renderer/components/changelog/ChangelogPanel.tsx`), Kids Mode as a set of dedicated screens
distinct from the pre-existing School mode (`src/renderer/components/kids/`:
`EnableKidsModeDialog.tsx`, `KidsActivityCanvas.tsx`, `KidsGate.tsx`, `KidsHome.tsx`,
`KidsParent.tsx`, `KidsShell.tsx`, `KidsStickers.tsx`, plus its own settings section and state
store), and a Minecraft server create/manage panel
(`src/renderer/components/minecraft/MinecraftServerPanel.tsx`) wired to
`src/core/minecraft/{java.ts,register-ipc.ts,server-manager.ts,version-resolve.ts}`. All four are
present in `check-app-contract.mjs`'s feature inventory with passing existence/content checks (see
Verification below).

**The design bundle lives at `design/v2/`.** Ten `.dc.html` handoff artifacts (Board, Canvas,
Files, History, Kids Mode, Overlays, Regex Builder, Settings, Tools, Welcome), a `support.js`, a
`HANDOFF-README.md`, and `design/v2/md3/tokens.css` (102 lines, 3,665 bytes) — the token contract
the rewrite drew from.

### Verification actually performed at `38280b0b` (this HEAD)

Every number below was observed by running the command, not assumed from a prior session's
report.

| Check | Command | Result |
|---|---|---|
| Type checking | `npm run typecheck` | **Clean.** Zero errors on both `tsconfig.node.json` and `tsconfig.web.json`. |
| Vocabulary lock | `node scripts/check-vocabulary.mjs` | Passed. |
| App contract | `node scripts/check-app-contract.mjs` | 725 assertions across 47 features. **3 failures**, all under "First-class Windows terminal profiles" (a suite-boundary string match, a pending built-artifact-interaction assertion, and a pending real-capture-evidence assertion) — none related to the M3 rewrite. The same run's "M3 foundation" checks passed: no CDN font/icon link across 748 scanned renderer files, all 46 M3 roles declared in the dark `:root` block, all 46 roles defined for both themes, and the app's `data-theme` attribute (not a stray `data-md-theme`) is what's actually used. |
| Site contract | `node scripts/check-site-contract.mjs` | 340 assertions, all clear. |
| Full test suite | `npx vitest run` (default parallel workers) | **691 test files: 677 passed, 7 failed, 7 skipped. 8,730 tests: 8,477 passed, 55 failed, 198 skipped.** Wall time 213.19 s. Full breakdown below. |
| Production build | `npm run build` (vocabulary + changelog checks, `electron-vite build`, `host:build`) | **Succeeded, exit 0.** Produces `out/main`, `out/preload`, `out/renderer` (including the ~7.6 MB `monaco-setup` chunk and the ~2.8 MB `boot` chunk) and `out/session-host/host.cjs`. |

**The redesign has never been visually verified. Nobody has launched the built app and looked at
it.** This pass ran `npm run build` and confirmed it exits 0 and produces the expected output
files; it did not run `npm run check:wired`, did not launch the packaged app on a headless
desktop, and took no screenshots of the new app bar, nav rail, project switcher, or FAB menu. A
clean typecheck and a clean production build are evidence the code compiles and bundles — they are
**not** evidence that the 64px bar actually renders at 64px, that the rail's destinations actually
open the right panels, that the re-seeded accent doesn't clash with something, or that the two
stylesheets' cascade order produces the intended result on screen. That gap is exactly the kind of
thing this document exists to be honest about rather than paper over.

### The seven failing test files, with cause

None of the 55 failing tests are new MD3 *layout* regressions beyond the one CSS defect below;
most belong to other work that landed at the same tip. Recorded here because they were found
while doing the verification this section reports, and leaving them undiagnosed would just mean
the next reader re-does this work.

1. **`src/renderer/styles.theme.test.ts` (2 failures) — real, and MD3-adjacent.** The Minecraft
   panel's `.mc-console` rule (`src/renderer/styles.css:14543-14554`) hardcodes
   `background: #000000` instead of a theme token, and both `.mc-console` and `.mc-path`
   (`styles.css:14453`, `14552`) reference an undefined `--mono` custom property — only
   `--mono-font` is actually defined anywhere in either stylesheet. This is very likely the exact
   drift this document's own earlier section already flagged in passing ("`src/renderer/styles.css`
   contains an unrelated unstaged user/other-session change (monospace token alias and terminal
   background token)... deliberately excluded from this session's commits") that never got
   finished. Not fixed here — out of scope for a document-only pass — but the cause is confirmed,
   not guessed.
2. **`src/core/build-bat.test.ts` (~19 failures)** — Windows batch installer-build tests
   (Authenticode probing, `cmd.exe` orchestration). Not MD3-related on its face; needs an isolated
   re-run per this repo's own documented contention guidance before attributing it to a real
   regression versus environment noise, which this pass did not have time to do.
3. **`src/core/fs-atomic.guard.test.ts` (1 failure) — real, and worth flagging loudly given how
   much this repo's own documentation (see "Atomic writes" above) cares about this exact
   invariant.** `core/local-history.ts` and `core/minecraft/java.ts` both publish through a bare
   `fs.rename`/`rename(` instead of the required `renameAtomic` helper. `core/minecraft/java.ts` is
   new code from this cycle (the automatic Java provisioning for managed Minecraft servers) and
   never got the atomic-write treatment this repo dedicates an entire section of `CLAUDE.md` to.
4. **`src/main/remote/relay-host-service.test.ts` (~28 failures) — not MD3-related.** These come
   from the Docker-hosted-remote-access work merged at the very tip (`fd752f51`/`d475bdee`); tests
   throw `Choose a local project before starting Docker host.` / `The selected project has no local
   Docker workspace.` — the test harness was not updated after `addSeat` grew a new required
   Docker-project precondition.
5. **`src/renderer/nodes/ServiceNode.test.tsx` (3 failures) — a test-harness gap from the new
   Minecraft surface.** The new `minecraft` kind renders `MinecraftServerPanel`, which calls
   `useSession()`; the shared `ServiceNode.test.tsx` harness (`render(...)` → `Harness`) never
   wraps in a `SessionProvider` for any kind, so the three Minecraft-specific cases throw `[session]
   useSession() outside a SessionProvider`.
6. **`src/renderer/terminal/webgl-addon-pair.test.ts` (1 failure) — an install artifact in this
   environment, not a source defect.** `node_modules/@xterm/addon-webgl/lib/` does not exist at all
   in this checkout (confirmed with `ls`), so the test's `fs.readFileSync` on
   `lib/addon-webgl.js` fails with `ENOENT` before it ever gets to compare version guards.
7. **`src/renderer/state/permissionMode.funnel.test.ts` (1 failure) — real, and in the new Kids
   Mode surface.** `components/kids/KidsParent.tsx` reads `settings.claudePermissionMode` directly
   instead of through `activePermissionMode()`, which is exactly the funnel-bypass class of bug
   this test exists to catch (it names the Kids-mode gate specifically).

### Corrections to other claims already in this file

Checked because the brief asked whether the file's existing draft-release text was still accurate
— it was not, and neither were two adjacent claims found along the way.

- **The two stranded drafts this file described (`v0.4.4`, `v0.4.5`) no longer exist.**
  `gh release view v0.4.4` / `v0.4.5` both return "release not found." Whether they were deleted by
  the repository owner or superseded some other way is not recorded anywhere this pass could find;
  either way, the "two drafts sitting there" state this document described is gone. In its place,
  as of this write, there is exactly **one** draft release across the entire repository (checked
  via `gh api repos/.../releases --paginate`, 100+ releases scanned): `v0.4.41`, whose
  `targetCommitish` is `38280b0b` — **this exact commit**. The pattern this document already
  documents (a failed run strands a version number nobody can reuse) is continuing under new
  numbers; it was not a one-time event that got cleaned up.
- **"`.github/workflows/release.yml` is a manual-only `workflow_dispatch` pipeline" and "Automatic
  publication is disabled because the workflow has no push trigger" are both false as of this
  commit.** Read directly from the file (`.github/workflows/release.yml:31-34`):
  ```yaml
  on:
    push:
      branches: [main]
    workflow_dispatch:
  ```
  The workflow's own header comment says plainly: "EVERY PUSH TO MAIN RELEASES. There is no manual
  bump step." `gh workflow list` confirms the Release workflow's status as `active`, and `gh run
  list --workflow=Release` shows it firing on essentially every push to `main` throughout
  2026-08-18/19, publishing a new version each time (`v0.4.27` through `v0.4.40` published, in
  order, over the course of the day this rewrite landed). `docs/ci-and-releases.md` describes the
  same old push-triggers-an-infinite-tag-loop incident and the resulting "no push trigger, ever"
  fix — that document is now **also** stale in the same direction as this one was; it is not
  touched by this pass (out of scope), but a future pass should reconcile it with the workflow file
  it is supposed to describe.
- **"The repository is public but has issues disabled... `gh issue list` fails for that reason" is
  false as of this commit.** `gh api repos/.../material-nodeterm --jq .has_issues` returns `true`,
  and `gh issue list --state open` returns two open issues (`#2` "Session handoff: test-suite
  reliability, two server leaks, integration research", `#3` "Add global defaults, full project
  settings, and Docker-hosted remote access") — neither is about the MD3 rewrite; `#2` is an
  earlier handoff largely covering ground this file's own later sections already describe (the
  temp-directory leaks, the contention-timeout run), and `#3`'s timing lines up with the
  Docker-hosted-deployment commits at this file's very first section. This pass did not post
  anything to either issue or open a new one; posting a handoff copy to GitHub Issues, now that
  they're enabled, is a reasonable next step for whoever picks this up, but it was not part of what
  was asked here.

### Published baseline, re-verified

- **Latest non-draft release: `v0.4.40`**, published `2026-08-19T04:03:10Z`, targeting commit
  `d475bdee6e60612722f62981c9a67c4f11f4e7e1`. Verified via `gh release view v0.4.40 --json
tagName,targetCommitish,publishedAt,isDraft,isPrerelease,assets`: `isDraft: false`,
  `isPrerelease: false`, three assets uploaded
  (`node-terminal-0.4.40-full.nupkg` 218,055,235 bytes, `nodeterm-Setup-0.4.40.exe`
  218,183,168 bytes, `RELEASES` 85 bytes).
- **Ancestry confirmed, not assumed**: `git merge-base --is-ancestor d475bdee HEAD` succeeds (the
  published target is an ancestor of this worktree's `HEAD`), and `git merge-base --is-ancestor
b4061448 d475bdee` also succeeds — the commit that deleted `TabBar.tsx`/`Dock.tsx` and wired in
  the nav shell is itself an ancestor of what `v0.4.40` shipped. **The published `v0.4.40` build
  does carry the Material Design 3 rewrite.** It does not carry the two Docker-hosted-deployment
  commits at this file's tip (`fd752f51`, `d475bdee`'s sibling `38280b0b` merge) — those are one
  and two commits ahead of what's published, respectively, and are what the draft `v0.4.41` (see
  above) is attempting and has not yet succeeded at publishing cleanly.
- Package version in the tree remains `"0.4.3"` (`package.json`), consistent with this release
  pipeline's documented design: the computed release version is applied to the working tree at
  build time and deliberately never committed back to `main`, so the Git tag (`v0.4.40`) is the
  source of truth for what shipped, not `package.json`.

### Open boundaries found or reconfirmed during this pass

- No built-artifact interaction proof (`check:wired`) or real screenshot capture exists for the
  Material Design 3 rewrite. This is the single biggest gap this addendum exists to name plainly.
- No dedicated documentation file exists for the M3 rewrite under a categorized `docs/` subfolder,
  unlike Kids Mode (`docs/kids-mode.md`) and the Minecraft server manager
  (`docs/minecraft-server-manager.md`), both of which ship one and both of which are checked for by
  `check-app-contract.mjs`. The "M3 foundation" contract check is narrower (four structural CSS
  assertions) and does not require or check for a feature write-up.
- `.mc-console`'s hardcoded black background and the dangling `--mono` token reference
  (`src/renderer/styles.theme.test.ts`, both failing) are unfixed.
- `core/local-history.ts` and `core/minecraft/java.ts` publish via bare renames instead of
  `renameAtomic` (`src/core/fs-atomic.guard.test.ts`, failing) — a real Windows data-loss risk per
  this repository's own extensively documented reasoning for why that helper exists.
- `components/kids/KidsParent.tsx` bypasses the permission-mode funnel
  (`src/renderer/state/permissionMode.funnel.test.ts`, failing).
- `ServiceNode.test.tsx`'s shared test harness has no `SessionProvider`, so all three
  Minecraft-kind test cases fail on mount.
- `src/core/build-bat.test.ts`'s ~19 failures and the `relay-host-service.test.ts` failures (Docker
  precondition, unrelated to MD3) were observed but not root-caused to the same depth as the items
  above in the time available for this pass; both deserve an isolated re-run.
- `CLAUDE.md`'s own "Window chrome" section still describes `TabBar.tsx` as the drag region
  (`CLAUDE.md:2060`); that file was not touched by this pass.
- `docs/ci-and-releases.md` still describes the release workflow as manual-`workflow_dispatch`-only
  with no push trigger, which the workflow file itself now contradicts; also not touched by this
  pass.
- The stranded-draft pattern this document already flagged is recurring under new numbers
  (`v0.4.41`, targeting this exact commit) rather than resolved.

### Next-owner note

Before claiming the Material Design 3 rewrite is release-ready: launch the packaged build (or run
`npm run build && npm run check:wired`) and actually look at the new app bar, nav rail, project
switcher and FAB menu on a real screen — nothing above substitutes for that. Then decide whether
the `.mc-console` styling defect and the two atomic-write violations found above are worth a
one-line fix before the next release, since both are small, both are diagnosed, and neither
requires touching anything MD3-specific to correct.

## 2026-08-27, AWS Shop and catalog enforcement, issue #40

The AWS Shop lane extends the existing special-universe Shop with an explicit inventory of all
planned AWS catalog rows: identity, Resource Explorer, Cloud Control, S3, EC2, IAM, STS, Lambda,
CloudWatch, CloudWatch Logs, CloudFormation, CDK, ECR, ECS, EKS, RDS, databases, VPC, Route 53,
cost management, and all-service operations. `src/renderer/state/universeShopCatalogProvider.ts`
keeps that inventory scope-bound, while `src/core/universe-shop.ts` resolves a selected id again
at execution time and rechecks the canvas scope, depth, and availability before forwarding the
immutable creation event to the live coordinator. Later-wave rows stay visible and explain their
disabled state instead of appearing as working provider operations.

The Shop search remains local and plain-text-first with its adjacent anchored full regex builder.
The card keeps keyboard-operable entry buttons, result status, localized copy, and accessible
disabled reasons. The docs article and its offline and site copies now list the complete AWS
inventory and describe the revalidation boundary. A finite invalid depth is normalized to the
safe child depth for catalog projection, and enabled rows no longer reference a nonexistent
disabled-description element.

Changed files: `src/core/universe-shop.ts`, `src/renderer/nodes/ShopNode.tsx`,
`src/renderer/state/universeShopCatalogProvider.ts`, `src/shared/node-catalog.ts`,
`src/shared/i18n/catalog.ts`, `docs/features/integrations/aws-universe-shop.md`,
`src/shared/docs-data.ts`, `site/docs/aws-universe-shop.html`, `CHANGELOG.md`, and this handoff.

The lane intentionally did not run tests, type checks, lint, security or accessibility checks,
builds, packaging, installer execution, runtime interaction, or captures. The preserved feature
commit is `86aac4f4b3684b4e67036c8e5846dcd42fab4552`; the later documentation and boundary update
is being committed on `feat/program-29-aws-shop` before it is pushed.
## Issue #51: GitLab Server hosting source lane

The `feat/program-40-gitlab-hosting` branch adds the `gitlab-hosting` canvas node and the typed
GitLab hosting surface. The implementation lives in `src/shared/gitlab-hosting.ts`, the guided
Docker manager extension in `src/main/remote/docker-host-manager.ts`, the preload and unsupported
bridge shape in `src/preload/index.ts` and `src/renderer/bridge/stubs.ts`, the node factory and
canvas registration in `src/renderer/state/workspace.ts` and `src/renderer/canvas/Canvas.tsx`, and
the UI in `src/renderer/nodes/GitLabHostingNode.tsx` plus
`src/renderer/components/gitlab/GitLabHostingPanel.tsx`.

The node offers pinned official Community Edition and Enterprise Edition image digests, four
managed volumes, loopback-only ports, readiness through `/-/readiness`, one-session initial root
credential handoff without logging or persistence, backup enumeration, restore, update, rollback,
bounded progress, and existing two-key confirmation for destructive actions. The project projection
stores only schema-versioned edition, image, binding, and guided ports. Contexts, container and
volume identifiers, backup files, credentials, and process state remain machine-local.

Directly related records are `docs/features/integrations/gitlab-hosting.md`, the integrations
index, the site card and `site/docs/gitlab-hosting.html`, the offline docs bundle entry in
`src/shared/docs-data.ts`, `CHANGELOG.md`, and the hosting row in `ROADMAP.md`.

This ultra-speed source lane intentionally ran no tests, type checks, lint, reviews, security or
accessibility checks, builds, packaging, installer execution, runtime interaction, or captures.
The parent integration lane must supply those verdicts and release evidence. The Server Edition
bridge reports its unavailable Docker boundary through the existing unsupported relay-manager
surface; no fake success is claimed.
## Timer nodes lane, issue #31

Implemented the timer node model in `src/shared/timer.ts`, the persistent occurrence coordinator in
`src/core/timer-service.ts`, and the canvas surface in `src/renderer/nodes/TimerNode.tsx`. The node is
registered as `timer`, has add-node, context-menu, and command-palette creation paths, and supports
countdown, stopwatch, interval sequences, pause/resume, laps, repeats, missed/completed occurrence
state, one-shot non-blocking alarms, and versioned JSON export data.

Documentation is in `docs/features/canvas/timer-nodes.md`. Tests, builds, captures, commits, and pushes
were intentionally left to the parent integration lane.
# Issue #25: Wild dim sum node source lane

The `feat/program-14-wild-dim-sum-node` branch adds the `wild-dim-sum` node kind, Unified Node
Catalog factory, renderer surface, localized control copy, bounded public-catalog loader, published
release-photo resolver, schema 3 portable selection, close-and-reopen path, CSP allowances, Material
Design 3 styling, feature documentation, offline docs page, changelog, and roadmap record.

Portable state is limited to validated public dish identity and display copy. Catalog response
bytes, image bytes, request state, browser cache, credentials, provider sessions, machine paths,
process state, host identifiers, and generated URLs remain excluded. Import has no network,
deployment, provider, process, or download side effect. Runtime photo availability depends on the
canonical public catalog and its published GitHub release assets; the installer contains no copied
photo.

This ultra-speed lane intentionally ran no tests, type checks, lint, builds, packaging, runtime
interaction, accessibility or security audits, reviews, or captures. The parent integration lane
must supply every verification verdict and release evidence before describing the feature as
verified.
# Issue #60, Cloudflare Tunnel wizard source lane

The isolated `feat/program-49-tunnel-wizard` lane adds the bounded wizard contract in
`src/shared/cloudflare-tunnel-wizard.ts` and the Material Design 3 renderer surface in
`src/renderer/components/cloudflare/CloudflareTunnelWizard.tsx`. It presents populated account,
zone, hostname, host, discovered container, network, port, and verified-origin choices; each picker
has isolated local search and an anchored regex builder. The host boundary receives only opaque
selection ids and the generated hostname, while the portable intent keeps desired labels and
network-independent values separate from local provider binding.

The direct article is `docs/features/remote/cloudflare-tunnel-wizard.md`, with the remote category
index, roadmap, and changelog updated. Progress, cancellation, retry, stale-selection refusal,
route review, and local vault-key binding are represented in the source contract. No tests, type
checks, lint, review, security or accessibility checks, builds, packaging, installer execution,
runtime interaction, or captures were run under the issue's ultra-speed boundary. Provider adapter
wiring and integration into the Cloudflare manager remain for the parent integration lane.
## Hosted-service Cloudflare Tunnel handoff lane, issue #56

The isolated `feat/program-45-hosted-cloudflare-handoff` lane adds the shared contract in
`src/shared/cloudflare-tunnel-handoff.ts`, the core sequencing and machine-local binding coordinator
in `src/core/cloudflare-tunnel-handoff.ts`, and the guided renderer surface in
`src/renderer/components/CloudflareTunnelHandoffPanel.tsx`. The handoff verifies a selected loopback
origin before provider mutation, checks that tunnel creation, connector startup, and external
verification are advertised by the provider capability record, requires an explicit exposure
confirmation, resolves the credential only inside the provider adapter, and separates local health,
connector state, DNS or tunnel state, and external reachability.

Portable state is limited to validated service and routing intent. Cloudflare account, zone, tunnel,
connector, credential, local endpoint, host identity, process state, and cache data stay in the
machine-local binding store. The reviewed loopback host, port, and origin are passed only as validated
local input and never become portable state. A failed external reachability check returns a partial
result and does not claim that the route is verified. A missing capability or provider adapter remains
visibly unavailable instead of being simulated.

This ultra-speed lane intentionally ran no tests, type checks, lint, builds, packaging, reviews,
security or accessibility checks, installer execution, runtime interaction, or captures. The parent
integration lane must wire the provider adapter and supply all build, packaging, runtime, and release
evidence before calling the feature verified.

# Issue #76: Annotation labels and line thickness

The `feat/program-65-annotation-labels` lane extends the existing annotation node from upstream
commit `c1507bea` with an optional bounded label and an editable stroke-thickness control. The
label renders beside the visual-only line or arrow, while the slider changes the SVG stroke width
from 1 through 16 local pixels with a default of 3. The annotation remains a canvas node with no
source, target, or connection handles.

The new presentation fields are normalized in `src/shared/annotation.ts`, carried through
`CanvasNodeState`, and serialized by `src/renderer/state/workspace.ts`. Schema 3 portable projection
now preserves and validates annotation variant, diagonal, label, and thickness in
`src/core/portable-canvas-projection.ts`. The feature article is
`docs/features/canvas/annotations.md`.

Issue #76's ultra-speed boundary intentionally did not run tests, type checks, lint, reviews,
security or accessibility checks, builds, packaging, installer execution, runtime interaction, or
UI captures. The parent integration lane must provide those verdicts before this feature is called
fully verified.
## Issue #58, Cloudflare manager lane

The isolated `feat/program-47-cloudflare-zero-trust` lane adds `src/shared/cloudflare-zero-trust.ts`,
`src/core/cloudflare-zero-trust/service.ts`, the Cloudflare manager canvas panel and styles, IPC and
Server Edition registration, and schema 3 portable intent handling. The seven fixed manager families
are Access, Zero Trust, Workers, Pages, R2, D1 and Queues. Credentials are sealed locally, while
portable project data carries only neutral selection intent. Typed fields, fixed routes, bounded
responses, per-search anchored regex builders, progress, cancellation, and destructive confirmation
are included.

This ultra-speed lane intentionally ran no tests, type checks, lint, builds, packaging, reviews,
security checks, accessibility checks, installer execution, runtime interaction, or UI captures.
The parent integration lane must verify the exact commit, reconcile any central-file overlap with
other lanes, and supply the remaining release evidence before claiming the feature verified.
# 2026-08-27, guided GitHub API capabilities, issue #101

Issue #101 is implemented on `feat/github-api-surface` in the dedicated feature checkout. The
shared `githubApi` contract in `src/shared/github-api.ts` is a hand-written inventory of typed REST
and fixed GraphQL operations covering repositories, source control, collaboration, projects,
Actions, releases, packages, deployments, organizations, teams, users, notifications, search,
security, rulesets, webhooks, apps, and account resources. Each operation records its scope,
transport, method, required semantic fields, pagination support, and destructive status.

`src/core/github/api-client.ts` builds only documented allowlisted routes and rejects endpoint input,
unbounded values, unsafe paths, unknown body fields, and invalid identifiers. `GitHubIssuesClient`
keeps the existing API version, redirect, timeout, bounded response, and rate-limit policy while
adding the fixed `account.profile` GraphQL document. Results are normalized and bounded, and
credential-shaped fields are omitted before they cross the bridge.

`src/core/github/api-service.ts` resolves credentials in the host, requires an approved project for
repository-scoped actions, limits concurrent work per UI, emits progress, supports cancellation,
and requires exact operation-scoped destructive confirmation. `src/core/github/api-handlers.ts`,
`src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/bridge/ws-bridge.ts`, and the shared API
type expose the same contract to Desktop and Server Edition. Relay tabs explicitly refuse this
account-bound namespace so they cannot use the viewer's credential or expose the host account.

Direct documentation is in `docs/features/integrations/github-api.md` and the integrations index.
`ROADMAP.md` records the feature as implemented but unverified. The generated in-app docs bundle
was not rebuilt because issue #101 forbids builds and verification; the feature pull request must
run the normal docs-bundle path before claiming a complete packaged surface.

No tests, type checks, lint, reviews, security or accessibility checks, builds, packaging, installer
execution, runtime interaction, audits, or screenshots were run, per the issue's explicit boundary.
The feature branch remains separate from `main` and is intended to remain available for the dedicated
pull request.

# 2026-08-27, Easter egg suite, issue #103

Implemented a hand-written 60-entry Easter egg catalog in `src/shared/easter-eggs.ts` and a
bounded renderer cabinet in `src/renderer/components/EasterEggs.tsx`. The cabinet is mounted at
the app root, hidden fail-closed under School mode, and exposes a three-second keyboard arm route
plus a functional Try button for keyboard, touch, and assistive technology users. Discovery state
is private local storage containing only catalog ids, with an explicit reset action. The status card
is non-blocking, uses a polite live region, and has a dismissal control. Reduced motion receives a
static presentation.

The catalog spans canvas, nodes, title bar, settings, command palette, notifications,
documentation, changelog, search, project switcher, source control, media, scheduling, hosting,
account, converter, local model management, authenticator, support, and status. Directly related
surface markers were added to the app bar, canvas, navigation rail, project switcher,
documentation, settings, history, source control, converter, and local model drawers.

Documentation is in `docs/features/appearance/easter-eggs.md` and indexed from the appearance
category. `ROADMAP.md` and `CHANGELOG.md` record the implementation and its intentionally pending
verification state.

No tests, lint, type checks, builds, packaging, runtime interaction, reviews, audits, or screenshots
were run, as required by issue #103. The feature branch remains separate from `main`; the parent agent
must perform integration and any later verification.

# 2026-08-27, Easter egg contextual-trigger correction, issue #103

Reconciled the task-owned feature branch with the exact `origin/main` tip
`54164b84dce0b7e62787b1de2885405ff4ed821c`. Corrected the Easter egg suite so every one of the 60
entries is a contextual, bounded surprise from natural interaction with its marked real surface.
Removed the `Ctrl+Alt+Shift+E` opener, all typed/code/chord activation, Alt-click force discovery,
and direct Try controls. The cabinet now appears only through a discovered status card and contains
discovery history plus Reset discoveries. The catalog retains ten funny levels, School-mode
suppression, accessibility, reduced-motion handling, local-only discovery persistence, and the
no-data-mutation, no-process-launch, no-network, and no-credential-access contract.

The contextual route uses a per-surface interaction counter, a three-interaction threshold, and a
45-second global cooldown. A discovered status card is non-blocking and offers dismissal plus a
history route. No new force-trigger affordance was added.

No tests, lint, type checks, builds, packaging, debugging, runtime interaction, reviews, audits, or
UI captures were run, as required by issue #103. Correction commit
`63ec24efa96f27880931d4cc3c6424f53f11feb9` was pushed to `feat/easter-egg-suite` and verified by
exact ref and ancestry checks. The feature branch remains separate from `main`; no PR, issue
mutation, deletion, or cleanup was performed.

# GitHub work-item canvas lane

Source implementation for upstream issue #462 and downstream issue #132 is on
`feat/github-pr-issue-canvas`. It adds a typed safe projection, a canvas node, catalog creation,
serialization, and the categorized article at `docs/features/integrations/github-work-items.md`.

The lane intentionally ran no tests, lint, typecheck, build, packaging, runtime interaction,
review, audit, debugging, repair, or UI capture. The next owner must verify Desktop and Server Edition
bridge parity, guided repository/item actions, refresh and permission/offline states, local search
and anchored regex builder behavior, and real built-artifact interaction.
## Issue #65, proxy and isolated debugging browser sessions

The issue lane `feat/program-54-proxy-debug-browser` adds a platform-free portable contract in
`src/shared/browser-debug-sessions.ts`, a host-owned lifecycle manager in
`src/main/browser-debug-session.ts`, a guided Material Design 3 picker in
`src/renderer/nodes/BrowserDebugSessionPicker.tsx`, and schema-bound intent fields in
`src/shared/types.ts`, `src/core/workspace-files.ts`, and
`src/core/portable-canvas-projection.ts`. Shared intent contains only profile, proxy, certificate
policy, isolation, and target selection. Local vault references, certificate and executable paths,
process state, cookies, storage, debugging endpoints, and diagnostic payloads remain local.

The manager refuses invalid or incomplete bindings with an explicit Configure, Rebind, Locate
certificate, Retry, or Stop action. It never falls back to the ordinary browser. It owns start,
stop, owner release, bounded diagnostic state, and host-side proxy credential resolution. The picker
has independent profile and proxy searches, each with its own anchored full regex builder.

Direct documentation is in `docs/features/remote/browser-debug-sessions.md` and the remote category
index. The offline bundle remains to be regenerated by the release owner. This ultra-speed lane did
not run tests, type checks, lint, reviews, security checks, accessibility checks, builds, packaging,
installer execution, runtime interaction, or UI captures. No release or artifact claim is made from
this lane.
# 2026-08-27, usage-threshold Claude account rotation, issue #81

The Program 70 implementation is on `feat/program-70-usage-account-rotation`, reconciled with
`origin/main` at `54164b84dce0b7e62787b1de2885405ff4ed821c`. The lane adds
`src/renderer/lib/usageAccountRotation.ts`, persisted `claudeUsageRotationEnabled` and
`claudeUsageRotationThreshold` settings, Usage-section controls, and default-account resolution
through the existing renderer launch funnel.

The policy is opt-in and defaults to a 90 percent threshold. It considers the highest reported
Claude limit, selects the account with the most headroom, uses reset time as a tie-breaker, and
falls back to the least-used known account when all known accounts are above the threshold. Missing,
stale, unavailable, or errored usage leaves the selected account unchanged. Explicit account picks
remain pinned, running sessions are never changed, and SSH-host accounts are outside the local
rotation scope.

Direct documentation is `docs/features/agents/usage-account-rotation.md`, indexed by the Agents
category. `CHANGELOG.md` and `ROADMAP.md` record the same scope. The generated in-app docs bundle
was not regenerated because this lane explicitly forbids builds and checks.

The original implementation commit was `414b785805251ab534bccf0a4a924a09d82f97e5`. The reconciled
lane commit follows the exact `origin/main` tip after merge resolution. No tests, type checks, lint,
reviews, security or accessibility checks, builds, packaging, installer execution, runtime
interaction, or screenshots were run. The parent owns the final integrated default branch, release
evidence, and any later verification.
# WSL copy coverage CRLF mutation repair

## Current status

The release run `33124056912` reached the WSL copy coverage check after packaging and
personal-vocabulary coverage succeeded. It reported two failures in the check's deliberate
negative mutation: the mutation did not remove an exact inventory row, and exact-row matching
was not proven.

## Cause and repair

The `red-wsl-copy-luna` checkout is a Windows checkout whose `src/renderer/wsl/wslCopy.ts` content
uses CRLF line endings. The checker
constructed an LF-terminated replacement string, so `String.replace` found no match and the
negative mutation silently left the source unchanged.

The repair in `scripts/check-wsl-copy-coverage.mjs` splits on CRLF, LF, or CR, locates exactly one
complete inventory row by whole-line equality, removes that indexed line, rebuilds with the
source's detected separator, and asserts that the resulting source differs. This keeps the
existing inventory and coverage checks unchanged while making the negative mutation independent
of checkout line endings.

## Verification boundary

No production checker, tests, lint, typecheck, build, package, runtime interaction, review,
audit, or screenshot was run in this ultra-speed repair lane. The change is committed and pushed
on the feature branch for the coordinating task to integrate after review.

# 2026-08-27, Codex relay daemon parser repair

Release run `33124918918` passed repository guards, the personal-vocabulary checker with 1149
clear entries, 48 WSL copy coverage rows plus its negative mutation, packaging provenance, icon,
and HTTPS checks, then failed during the application build at
`src/main/codex-relay-daemon.ts:14:1` with `ERROR: Expected identifier but found "*"`.

The cause was a malformed merge splice at the file header: a short comment and import set had
already closed, a raw long-comment continuation followed, then a second complete import set and
duplicate `SAFE_NODE_TOKEN` declaration appeared. The same file also contained stale duplicate
implementations for `ensureServer`, `hookEndpointOptions`, `register`, and `exposeThread`, plus
duplicate lock inspection, endpoint parsing, route validation, reservation, response rewriting,
and foreign-rollout copy blocks.

The repair reconstructs one valid header comment containing the relay rationale and probe history,
keeps one import per symbol, retains the protocol v6 account-isolated catalog and atomic rollout
exposure path, and keeps the canonical `kid.mac` token pattern with a 43-character MAC. It removes
only the stale duplicate or malformed fragments and keeps the descriptor-based lock inspection,
quote-aware endpoint parser, synchronous reservation primitive, and target-side rollout discovery
rollback behavior.

Changed files: `src/main/codex-relay-daemon.ts` and `HANDOFF.md`. No tests, checkers, lint, type
checks, builds, packaging, installer execution, runtime interaction, reviews, audits, or UI
captures were run in this lane. The coordinating owner must evaluate the exact merged commit and
the resulting remote workflow before treating the release as recovered.
