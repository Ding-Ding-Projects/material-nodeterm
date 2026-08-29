# Canonical feature inventory

This is the hand-written, per-surface completeness inventory the shared agent instructions require
of every project. It names **every** canonical user-facing contract — including the ones this
project does not implement — and links the implementation, the documentation article, and the
focused test for each.

**Why hand-written, and why that word is load-bearing.** A registry derived from what is already on
disk validates only the features it happens to find, so a feature that disappeared entirely would
disappear from the check too and the check would stay green. That is the exact failure this file
exists to prevent, so every row below is typed out by a person (or an agent acting as one) and
`scripts/check-uh-inventory.mjs` fails when a named row's evidence is missing. Adding a feature
means adding its row; deleting a feature means deleting its row deliberately, in the open.

**How to read the Status column.**

- **shipped** — implemented, documented, and covered by a focused test.
- **not applicable** — the contract genuinely cannot apply to this product, with the reason stated.
  The instructions permit this and require the reason; they do not permit a silent gap.
- **open** — applies, and is not done. An open row is a defect with a name, not an oversight.

**How to read the `Closes when` column, and why it exists.** Four rows in the Open table were
stale for a day: the work landed and nobody came back to move the row. The guard could not
notice, because it validates that *shipped* rows point at real files and checks nothing about
whether an open row is still open — Open-row validation was a prose-length check. Worse, the
stale table is bundled into the shipped app, so nodeterm spent that day telling its own users
that four shipped features were missing.

So every open row now carries one machine-evaluable exit condition, and
`scripts/check-uh-inventory.mjs` fails when a blocker has dissolved:

- `absent:<path>` — red once that file exists.
- `fails:<command>` — red once that command starts exiting 0.
- `contract:<id>` — red once `scripts/check-app-contract.mjs` has a passing row with that id.
- `manual:<reason>` — the escape hatch for a blocker no script can observe. The reason is
  mandatory and is **printed on every run**, so a lazily-written one is visible to a reviewer
  rather than hiding behind a green tick.

The honest limit: this only catches what the row author thought to declare. It is not a
substitute for the rule that a commit closing a blocker closes its row in the same commit —
the discipline `380a8df5` almost had, since it was titled "close the three inventory rows"
and then never edited this file.

---

## Shipped

| Feature | Implementation | Documentation | Focused test |
| --- | --- | --- | --- |
| Language modes (English / Cantonese / bilingual) | `src/core/settings-store.ts` | `docs/language-modes.md` | `src/core/settings-store.test.ts` |
| Both funny-level sliders, independent per language | `src/renderer/components/settings/sections/LanguageSection.tsx` | `docs/language-modes.md` | `src/renderer/lib/i18n.test.tsx` |
| Emoji-in-dialogs switch | `src/renderer/components/settings/sections/LanguageSection.tsx` | `docs/language-modes.md` | `scripts/check-app-contract.mjs` (`emoji-toggle` row — no behavioral suite covers the switch) |
| School mode | `src/core/school-mode.ts` | `docs/school-mode.md` | `src/core/school-mode.test.ts` |
| Kids mode | `src/core/kids-mode.ts` | `docs/kids-mode.md` | `src/core/kids-mode.test.ts` |
| Narrator, with a voice picker per language | `src/renderer/canvas/narration-policy.ts` | `docs/narrator.md` | `src/renderer/canvas/narration-policy.test.ts` |
| Scheduled settings, incl. external sources | `src/core/scheduled-settings-runtime.ts`, `src/renderer/canvas/Canvas.tsx`, `src/renderer/lib/appearance/apply.ts` (schema v2 transient layout and appearance effects) | `docs/scheduled-settings.md` | `src/core/scheduled-settings-runtime.test.ts` |
| Dim sum surprise | `src/renderer/components/DimSumSurprise.tsx` | `docs/dim-sum.md` | `src/renderer/components/DimSumSurprise.test.tsx` |
| Regex builder, anchored beside every search | `src/renderer/components/regex/AnchoredRegexBuilder.tsx` | `docs/regex-builder.md` | `scripts/check-app-contract.mjs` (`regex-builder` row asserts the builder is wired into five real search surfaces — no behavioral suite exists) |
| ADHD modes | `src/renderer/lib/adhdModes.ts` | `docs/adhd-modes.md` | `src/renderer/lib/adhdModes.test.ts` |
| Non-blocking notifications + centre | `src/renderer/components/NotificationCenter.tsx` | `docs/notifications.md` | `src/main/notifications.test.ts` |
| Destructive-action super confirmation | `src/renderer/components/DestructiveConfirmGate.tsx` | `docs/destructive-confirmation.md` | `src/renderer/components/DestructiveGateHost.test.tsx` |
| Material Design 3 across every surface | `src/renderer/styles.md3.css` | `docs/md3-render-verification.md` | `src/renderer/styles.split.test.ts` |
| MD3 primitive set | `src/renderer/ui/md3/primitives.css` | `docs/md3-primitives.md` | `src/renderer/ui/md3/primitives-wired.test.ts` |
| Complete Material Design 3 desktop surface audit | `scripts/check-material-audit.mjs` + `docs/features/appearance/material-3-audit.md` | `docs/features/appearance/material-3-audit.md` | `scripts/check-material-audit.mjs` (1,634 source assertions, including the deleted-row mutation) |
| Per-element appearance editor | `src/renderer/components/appearance/AppearanceEditor.tsx` | `docs/appearance.md` | `scripts/check-app-contract.mjs` (`appearance-editor` row — no behavioral suite covers the editor itself; `logoSelection.test.ts` covers only the logo leg) |
| Infinite colour picker + translator | `src/renderer/components/color/ColorPicker.tsx` | `docs/colour-picker.md` | `src/renderer/components/color/ColorPicker.test.tsx` |
| App rename (display name only) | `src/renderer/components/settings/sections/AppIdentitySection.tsx` | `docs/app-rename.md` | `src/renderer/components/settings/sections/AppIdentitySection.test.tsx` |
| App-logo customization + safe conversion | `src/renderer/components/settings/sections/AppIdentitySection.tsx` | `docs/app-logo.md` | `src/renderer/components/settings/sections/AppIdentitySection.test.tsx` |
| Universal file converter | `src/core/converter/service.ts` | `docs/file-converter.md` | `src/core/converter/service.atomic-write.test.ts` |
| Local Ollama suite manager | `src/core/ollama/catalog-pure.ts` | `docs/ollama-manager.md` | `src/core/ollama/catalog-pure.test.ts` |
| Project repository graph universe | `src/core/repository-graph-service.ts`, `src/renderer/nodes/RepositoryGraphNode.tsx`, `src/shared/repository-graph.ts` | `docs/features/projects/repository-graph-universe.md` | accelerated lane, focused test path `src/core/repository-graph-service.ts` is intentionally unrun, as are runtime captures |
| Linux ISO VM node | `src/core/virtual-machine/manager.ts`, `src/renderer/nodes/VirtualMachineNode.tsx`, `dependencies.manifest.json`, `resources/qemu/README.md` | `docs/features/integrations/linux-iso-vm.md` | `src/core/virtual-machine/manager.test.ts` (written, not run in ultra-speed lane) |
| Tabbed navigation | `src/renderer/components/ProjectSwitcher.tsx` | `docs/features/projects/projects-and-tabs.md` | `src/renderer/state/projects.test.ts` |
| Toy locks on every element | `src/core/secure-store.ts` | `docs/toy-locks.md` | `src/core/secure-store.test.ts` |
| Unlock ladder | `src/core/unlock-ladder.ts` | `docs/unlock-ladder.md` | `src/core/unlock-ladder.test.ts` |
| Built-in authenticator + QR pairing | `src/core/toylocks/authenticator-service.ts` | `docs/authenticator.md` | `src/core/toylocks/authenticator-service.test.ts` |
| Changelog viewer | `src/renderer/components/changelog/ChangelogPanel.tsx` | `docs/changelog-viewer.md` | `src/shared/changelog.test.ts` |
| Command palette | `src/renderer/components/CommandPalette.tsx` | `docs/command-palette.md` | `src/renderer/components/CommandPalette.disabled.test.tsx` |
| Local version history | `src/core/local-history.ts` | `docs/local-history.md` | `src/core/local-history.test.ts` |
| Personal-vocabulary JSON upload | `src/renderer/state/personalVocabulary.ts` | `docs/personal-vocabulary.md` | `src/renderer/state/personalVocabulary.test.ts` |
| Export everything, in every format | `src/renderer/components/ExportMenu.tsx` | `docs/exports.md` | `src/shared/export/codec-roundtrip.test.ts` |
| Bulk actions on every list | `src/renderer/components/BulkActionBar.tsx` | `docs/bulk-actions.md` | `scripts/check-app-contract.mjs` (`bulk-actions` row — no behavioral suite covers `BulkActionBar`/`bulkSelection`) |
| Landing page and documentation site | `site/index.html` | `docs/site.md` | `scripts/check-site-contract.mjs` |
| Shared-link embed graphic | `site/assets/social-card.png` | `docs/site.md` | `scripts/check-site-contract.mjs` |
| One-click build scripts | `build.bat` | `docs/building.md` | `src/core/build-bat.test.ts` |
| One-click dependency fetcher | `download-dependencies.bat` | `docs/building.md` | `src/core/build-bat.test.ts` |
| Vocabulary hash lock | `scripts/check-vocabulary.mjs` | `scripts/check-vocabulary.mjs` (the script's own header is the documentation, deliberately — the subject is private and no separate docs article covers it) | `scripts/check-vocabulary.mjs` |
| Dim-sum release code names | `scripts/dim-sum-code-name.mjs` | `docs/ci-and-releases.md` | `scripts/dim-sum-code-name.test.mjs` |
| Design-reference parity app | `design/v2-preview/main.js` | `docs/md3-render-verification.md` | `scripts/capture-shots.mjs` |
| In-app documentation browser | `src/renderer/components/DocsBrowser.tsx` | `docs/features/help/README.md` | `scripts/check-docs-bundle.mjs` |
| External-editor handoff | `src/core/vscode-detect.ts` | `docs/exports.md` | `src/core/vscode-detect.test.ts` |
| Line count in every release | `scripts/count-lines.mjs` | `docs/ci-and-releases.md` | `scripts/release-notes.test.mjs` |
| Sanitized instruction mirror | Full byte-identical managed blocks in `AGENTS.md` and `CLAUDE.md`, the concise `README.md` summary, and `scripts/sync-agent-instruction-mirror.mjs` | `scripts/sync-agent-instruction-mirror.mjs` and `scripts/check-instruction-mirror.mjs` headers document the private-export, public-review, synchronization, and check-only routes | `scripts/check-instruction-mirror.test.mjs` covers missing targets, required-section loss, parity drift, marker corruption, sensitive-input refusal, unchanged targets on refusal, and preservation of surrounding project guidance |

## Not applicable, with the reason

| Feature | Why it cannot apply here |
| --- | --- |
| Browser-extension download capture dialogs (Start / Downloading / completion) | nodeterm ships no browser extension and captures no downloads. The contract describes a download manager's three surfaces; the sibling project `material-download-manager` is where it lives. Inventing a download-capture flow here would add a surface with no traffic through it, which is worse than an absence with a reason. Revisit the moment nodeterm grows a browser extension. |
| Purchase / licence / paid-tier flows | Nothing in nodeterm costs money. The instructions forbid nagging for payment and this project has no paid tier to gate, so there is no purchase surface to build. |

## Open

| Feature | What is missing | Closes when | Notes |
| --- | --- | --- | --- |
| UniGetUI Global Universe | Focused tests, type checks, runtime interaction, and captures. | `manual:issue #212 accelerated lane intentionally runs no tests` | `src/core/unigetui/register-ipc.ts`, `src/renderer/components/unigetui/UniGetUiUniversePanel.tsx`, and `docs/features/integrations/unigetui-global-universe.md` provide the implementation and documentation. |
| VeraCrypt mount management | Focused tests, type checks, runtime interaction, and captures. | `manual:issue #210 accelerated lane verification remains pending` | `src/core/veracrypt/service.ts`, `src/renderer/nodes/VeraCryptNode.tsx`, and `docs/features/integrations/veracrypt.md` provide the implementation and documentation. |
| Agent continuation recovery | Cold-relaunch integration, negative-path tests, type checks, runtime interaction, and captures. | `manual:issue #198 continuation recovery verification remains pending` | `src/core/agent-continuation.ts`, `src/renderer/components/AgentContinuationReview.tsx`, and `docs/features/agents/agent-continuation.md` provide the implementation and documentation. |
| Home Assistant multi-instance client | Focused tests, built-artifact interaction, and capture evidence. | `manual:issue 26 explicitly forbids checks and captures in its ultra-speed implementation lane` | Source, documentation, machine-local credential and instance persistence, REST and WebSocket discovery, and portable intent are implemented in issue #26. |
| Automatic node dependency installation | Focused lifecycle/IPC verification, generated offline docs refresh, and Node Catalog `Install and continue` integration. | `manual:the foundation requires the next verification and catalog lanes before this row can be marked shipped` | Manifest, cache, bounded installer, repair, cancellation, restart reconciliation, and desktop/Server Edition typed IPC landed in the 2026-08-26 foundation lane. |
| Status Hub | The registration half only. | `manual:the shared Hub is an external service; nothing in this repository can observe whether registration happened` | **Narrowed 2026-08-20, and the app half is now in the Shipped table above as its own contract row.** The surface shipped in `3e96ad78` — `src/renderer/components/StatusSurface.tsx`, `src/shared/project-status.ts`, `docs/status-surface.md`, 31 tests in `src/shared/project-status.test.ts`, and a `status-surface` row in `scripts/check-app-contract.mjs`. What remains is reporting *into* the shared Hub, which is a service outside this tree — hence the `manual:` predicate rather than a machine-checkable one. |
| Special-universe Shop nodes | Implementation and documentation are present, but the lane's explicit boundary leaves tests, builds, runtime interaction, and captures unrun. The p05 unified catalog provider remains an integration dependency. | `manual:issue #17 verification boundary is lifted and focused evidence is recorded` | `src/core/universe-shop.ts`, `src/renderer/nodes/ShopNode.tsx`, and `docs/features/integrations/aws-universe-shop.md` provide deterministic collision-safe identity, scope/depth validation, import repair, idempotence, mutation refusal, and the accessible Shop surface. |
| Torrent Downloader | Focused tests, built-artifact interaction, and captures remain pending for this ultra-speed implementation lane. | `manual:run the focused downloader tests and built-artifact capture before release` | `src/core/torrent/service.ts`, `src/renderer/nodes/TorrentNode.tsx`, `docs/features/torrents/torrent-downloader.md` are the implementation and documentation evidence. |
| Planner occurrence service | Focused implementation is present, but schema 3 planner-definition transfer and the generated offline article are still missing. The ultra-speed lane intentionally has no test, build, packaged-interaction, or capture evidence yet. | `manual:add schema 3 planner intent and Configure import, refresh the offline article, then run the focused planner checks and built-artifact lifecycle proof before release` | Host-owned schedules, recurrence, timezone/DST handling, missed history, durable-before-delivery events, ordered host storage, stale-UI preservation, save retry, destructive deletion confirmation, Desktop title-bar-close continuity, Desktop IPC, Server Edition WS-RPC, and the Planner settings surface are implemented in this lane. |
| Cloudflare Access, Zero Trust, Workers, Pages, R2, D1 and Queues managers | Focused tests are missing, so the implementation is not yet verified as shipped. | `manual:issue #58 must add and run the focused Cloudflare Access and Zero Trust tests before this row can be marked shipped` | The implementation and documentation are present, but the issue-bound focused-test condition remains open. |
| cloudflared connector runtimes | Shared typed intent, credential storage, and main-process lifecycle manager are present; tests, built-artifact interaction, packaging, and captures remain unrun in issue #61's ultra-speed lane. | `manual:issue #61 verification boundary is lifted and focused lifecycle evidence is recorded` | `src/shared/cloudflared-runtime.ts`, `src/main/remote/cloudflared-runtime.ts`, `docs/features/remote/cloudflared-runtimes.md`, and `site/docs/cloudflared-runtimes.html` cover per-user process, Windows service, Docker connector, fixed argv, ownership, progress, health, credentials, and portable intent. |

---

## What this file does not claim

It records that each shipped row has an implementation, a document and a test. It does **not** claim
every row has been driven in the built artifact or captured, which is a separate and stricter bar —
`docs/assets/shots/capture-manifest.json` is the record of what has actually been photographed, and
`npm run check:wired` of what has actually been interacted with. Where those two disagree with this
file, they are right and this file is stale.
