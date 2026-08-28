# Changelog

## Unreleased

- Expand UniGetUI controls with guided package options, ignored-update handling, manager executable
  and notification controls, operation output, bundle file import/export, source management, local
  and cloud backup actions, and super-confirmed destructive actions. Bundle imports require a native
  local file selection and do not send raw content through process arguments.

  UniGetUI controls 加碼：package options、ignored updates、manager executable 同 notifications、operation output、
  bundle file import/export、source management、local/cloud backup，同埋有 super confirmation 嘅 destructive actions。
  Bundle import 一定用 native local file picker，唔會將 raw content 放入 process arguments。

- Add a machine-owned UniGetUI Global Universe with typed local automation, package discovery and
  operations, installed and update views, manager/source/settings/bundle/log/backup surfaces, and
  explicit unavailable, malformed, stopped, not-installed, elevation-required, and partial-operation
  states. Project files keep only a safe portal intent, never package-manager state or credentials.

  新增獨立嘅 UniGetUI 全域宇宙，透過官方本機 automation 做搜尋、安裝、更新、下載、解除安裝、修復，
  仲有 managers、sources、settings、bundles、logs 同 backups。Project file 只留安全入口，唔會偷渡套件狀態
  或 credentials；未安裝、停機、回應壞咗、要提升權限同部分完成都會清楚講。

- Fix packaged Windows startup after the file-converter pipeline added Sharp. The package now
  classifies Sharp and its native Windows binary as production dependencies, loads Sharp only when
  an image conversion needs it, and refuses any installer output that omits either runtime file.
  Early bootstrap failures now show a native recovery dialog with a sanitized error category and
  recovery instructions instead of exiting invisibly. The broken `0.4.142` package exited before
  opening a window with `MODULE_NOT_FOUND`.

- Remove the duplicate portable-binding IPC registration that rejected the async desktop startup
  chain before `createWindow()`, leaving a black host surface with no renderer. The shared provider
  registrar is now the single owner. Any future asynchronous startup rejection uses the same native,
  sanitized recovery dialog as an early module-load failure instead of becoming an unhandled promise.

  移除重覆 portable-binding IPC registration。之前 async desktop startup 會喺 `createWindow()` 前
  reject，只剩黑畫面同零 renderer。依家 shared provider registrar 係唯一 owner；之後任何 async
  startup rejection 都會彈同一個安全 native recovery dialog，唔再變 unhandled promise。

  修正 file converter 加入 Sharp 後 Windows package 開唔到嘅問題。Sharp 同佢嘅 Windows native
  binary 而家正式當 production dependency，只有 image conversion 真係要用先載入；installer
  漏咗任何一件 runtime file 都會即刻拒絕。Early bootstrap 出事會彈 native recovery dialog，
  唔再靜雞雞收工。壞咗嘅 `0.4.142` 之前會喺開 window 前就 `MODULE_NOT_FOUND` 收工。

- Repair deferred settings persistence, runtime settings fragments, and settings filtering when
  regex-only state is absent. Focused AccountsSection and settings coverage passes 14 of 14 tests.

  修正 deferred settings persistence、runtime settings fragment，同 regex state 缺失時嘅 settings
  filter。Focused AccountsSection 同 settings coverage 通過 14/14 tests。

- Normalize trailing directory separators before comparing the helper-selected and `VsDevCmd`
  Visual Studio identities on hosted runners. Equivalent paths now remain equivalent while a
  genuinely different installation is still rejected.

  Hosted runner 比較 helper 選定同 VsDevCmd 回傳嘅 Visual Studio 路徑時會先處理尾部 directory
  separator；同一條路唔會因為多個反斜線而誤拒，真係唔同 installation 仍然會拒絕。

- Run the hosted Visual Studio bootstrap in its dedicated elevated-toolchain-only mode, matching
  the administrator token used by the hosted Windows runner while keeping npm and project lifecycle
  scripts outside that privileged helper.

  Hosted Windows runner 用 Administrator token，所以 Visual Studio bootstrap 改用專用
  elevated-toolchain-only mode；npm 同 project lifecycle scripts 仍然唔會塞入嗰個 privileged helper。

- Bootstrap the selected Visual Studio developer environment and x64 Spectre libraries in the
  hosted release workflow before native dependency installation. This carries the same validated
  toolchain selection used by the local BAT route into the hosted packaging process.

  Hosted release workflow 而家會喺 native dependency install 前 bootstrap 已選定嘅 Visual
  Studio developer environment 同 x64 Spectre libraries，將本地 BAT route 已驗證嘅 toolchain
  selection 一齊帶入 hosted packaging。

- Repair hosted release setup so `actions/setup-node` uses the exact Node `24.19.0` declared by
  `package.json`. The workflow contract now rejects any drift, release notes consume the already
  paginated prior release bodies to avoid a repeated dim-sum code name, and the next release
  version is `0.4.122`.

  Hosted release setup 而家同 `package.json` 一樣用準確 Node `24.19.0`；workflow contract 會拒絕
  runtime drift，release notes 會讀返已經 pagination 完嘅舊 release bodies，避免重覆 dim-sum
  code name。下一個版本係 `0.4.122`。

- Keep post-build installer verification bound to the source identity captured before managed
  QEMU and AWS resource bootstraps. The standalone verifier now validates that recorded identity
  from icon metadata instead of misclassifying the build's own generated resources as source edits.

  Package 後面嘅 installer verification 而家用 bootstrap 前已記錄嘅 source identity；唔會再將
  build 自己生成嘅 QEMU 同 AWS resource 當成 source edit 而誤拒。

- Extract the SHA-512-verified QEMU NSIS archive with the 7-Zip executable bundled by the declared
  packaging dependency, instead of executing the downloaded setup. The extractor path is fixed,
  never comes from PATH, and is exercised with the real pinned archive before packaging.

  而家唔會直接執行下載返嚟嘅 QEMU setup；會用已宣告 packaging dependency 入面 bundled 嘅
  7-Zip 解開 SHA-512 已驗證嘅 NSIS archive。extractor 路徑固定，唔會喺 PATH 度亂搵。

- Make the Windows QEMU packaging bootstrap tolerate short-lived executable locks from scanning
  or indexing. It retries only pre-start `EACCES`, `EPERM`, and `EBUSY` failures through a finite
  1.85-second backoff, never retries a child that started, and preserves a primary installer
  failure if later owned-file cleanup is also locked. The focused retry suite was deliberately
  made red by removing `EACCES`, then restored green.

  Windows 上新寫入嘅 QEMU installer 有時會畀掃描器或者 indexer 短暫鎖住；而家只會對未成功
  開始前嘅 `EACCES`、`EPERM` 同 `EBUSY` 做有限重試，已經開始咗嘅 child 失敗就唔會重試。
  清理同時失敗亦唔會蓋過原本 installer error。測試刻意移除 `EACCES` 後確實變紅，再還原後
  變綠。

- Show the stamped package version and second-precision local updated time on the start screen.
  The stamped version remains visible when the optional runtime bridge is unavailable, while
  missing or invalid build provenance reports an honest unavailable state. This rapid lane ran
  no tests, type checks, lint, reviews, audits, builds, packaging, runtime interaction, or screen
  captures.

  開機畫面而家會顯示打包版本同精確到秒嘅本地更新時間；橋接器唔得都唔會令版本資料消失，
  冇效來源就老實顯示未能提供。今次快速 lane 冇跑 tests、type checks、lint、reviews、audits、
  builds、packaging、runtime interaction 或 screen captures。

- Add an explicit Codex crash-recovery continuation surface. One encrypted, bounded packet per node
  is derived from provider events, reviewed beside the owning node, and cleared only after a
  verified next-turn receipt. Failed provider start, delivery, and receipt checks retain the packet;
  terminal scrollback and credential-shaped content remain outside the boundary. Tests, builds,
  packaging, runtime interaction, and captures were not run in this ultra-speed lane.

- Repair the renderer stylesheet merge remnants around the destructive confirmation surface. The
  destination gate now has complete standalone overlay, heading, key, progress, completion, action,
  exit, hover, reduced-motion, and anchored-scrim rules. The interleaved card-modal resize, header,
  and rendered-markdown rules remain available as independent selectors, and the other ten missing
  declaration boundaries in the stylesheet are closed. This ultra-speed repair ran no tests, type
  checks, lint, reviews, audits, builds, packaging, runtime interaction, or screen captures.

  Stylesheet merge leftovers 清走晒：destructive confirmation gate 而家有返完整 overlay、heading、key、
  progress、completion、action、exit、hover、reduced-motion 同 anchored-scrim rules。card modal 嘅
  resize、header 同 rendered-markdown styles 亦保留，而且各自企返喺獨立 selector 入面。今次
  ultra-speed repair 沒有執行 tests、type checks、lint、reviews、audits、builds、packaging、runtime
  interaction 或 screen captures。

- Restore the core board-attachment detector export used by portable project import. The detector
  remains byte-derived and shared, preserving MIME and extension classification, bounded attachment
  carriers, path safety, and archive integrity validation while restoring the correct core import
  boundary. This ultra-speed repair ran no tests, type checks, lint, reviews, audits, builds,
  packaging, runtime interaction, or screen captures.

  Merge leftovers 清走晒：board attachment detector 重新由 core boundary export，portable import
  可以继续用同一套 byte classification，path safety 同 archive integrity 都原封不動。今次
  ultra-speed repair 沒有執行 tests、type checks、lint、reviews、audits、builds、packaging、runtime
  interaction 或 screen captures。

- Restore the Cloudflare Tunnel route planner after a merge retained the closing brace from a
  block-bodied conflict branch beside the one-line return from another version. Route ownership
  conflicts and DNS-only conflicts now remain inside the same guarded planning operation, with the
  existing fail-closed tunnel, hostname, path, zone, DNS-record, and explicit-adoption checks
  unchanged. A single-file esbuild transform recorded syntax-only evidence. This ultra-speed repair
  ran no tests, type checks, lint, reviews, audits, builds, packaging, runtime interaction, or screen
  captures.

- Remove residual duplicate declarations in the PTY manager, shared settings defaults, and torrent
  service. The PTY manager now has one complete end-session implementation, the Windows terminal
  font fallback keeps the current Consolas and Cascadia Mono stack, speech keeps its explicit no-
  dictation default, and the torrent service keeps its public task subscription method without a
  class-member name collision. A single-file esbuild transform reported `PARSE_OK` for each changed
  source file. This ultra-speed repair ran no tests, type checks, lint, reviews, audits, builds,
  packaging, runtime interaction, or screen captures.

  Merge leftovers 清走晒：PTY 收返一份完整收尾流程，Windows 字型保留現行 fallback，speech 繼續
  支援明確停用 dictation，torrent listener 唔再同 callback 撞名。三個 source file 各自通過
  `PARSE_OK` syntax evidence；其餘 checks 今次 ultra-speed repair 沒有執行。
- Reconstruct the SSH project manager after a merge retained two remote Codex account and runtime
  implementations. The manager now keeps one safe-home-validated account lifecycle, one
  credential-local identity path, one executable-only runtime installer, and one relay-source
  provider, while preserving per-node token materialization, live host status, OAuth forwarding,
  and the current project and canvas integrations. Duplicate imports and displaced method
  documentation were removed with the obsolete blocks. A single-file esbuild transform recorded
  syntax-only evidence. This ultra-speed repair ran no tests, type checks, lint, reviews, audits,
  builds, packaging, runtime interaction, or screen captures.

- Reconcile stale merge fragments in `src/main/index.ts`. The main process now keeps one import
  declaration per duplicated filesystem, Electron, SSH, account, and notification helper; one quit-confirmation
  declaration and detail; one configurable-shortcut interception path; one native-notification
  composition path; one `codexAccounts` provider and `registerNode` object key; the corrected
  `initSshProject` argument order and separator; one nested before-quit condition; and one
  keep-awake teardown. This ultra-speed repair ran no tests, type checks, lint, reviews, audits,
  builds, packaging, runtime interaction, or screen captures.

- Reconstruct the Codex relay daemon after a merge retained incompatible fragments from several
  implementations. The daemon now keeps one descriptor-based process-lock inspection, one relay
  root and server path, one quote-aware endpoint parser per request helper, one synchronous thread
  reservation path, and one response-error rewrite. The existing stdin capability registration,
  strict account validation, atomic rollout exposure, and native-thread outcome remain intact. A
  single-file esbuild transform recorded syntax-only evidence. This ultra-speed repair ran no
  tests, type checks, lint, reviews, audits, builds, packaging, runtime interaction, or screen
  captures.

- Repair WSL copy coverage for the validation phase. The catalogue now supplies ten English and
  Cantonese variants for `wsl.create.progress.validating`, with a factual level-one fallback and
  bilingual resolution. The coverage regression removes the first parsed inventory row using exact
  line boundaries that work for both CRLF and LF, and fails if the mutation is a no-op. This
  ultra-speed repair ran no tests, type checks, lint, reviews, audits, builds, packaging, runtime
  interaction, or screen captures; only JavaScript syntax evidence was permitted.

- Repair the personal-vocabulary coverage contract after the merge recovery combined newer
  producer lanes with an older canonical manifest. The hand-written implementation array and its
  independent canonical list now contain the same 145 unique producer identifiers, including all
  rows already documented by the Material audit. Settings restores its real mapper and registration
  boundaries, Canvas keeps one notification for each project-save outcome, and every retained Canvas
  notification classifies authored copy separately from runtime facts. The Canvas subinventory names
  57 checker-retained production calls in source order, while the two nested planner notifications
  remain explicitly classified in their action. This ultra-speed repair ran
  no tests, type checks, lint, reviews, audits, runtime interaction, packaging, or screen captures;
  only JavaScript syntax and source-record consistency were checked locally.

- Pin source builds to Node 24.19.0 before native dependency lifecycle scripts run. Node 26.4.0
  publishes Clang thin-LTO settings through its build metadata, which caused node-gyp to forward
  `-flto=thin` and `/opt:lldltojobs=2` into MSVC while compiling `smart-whisper`. The one-click
  dependency bootstrap now selects the SHA-pinned manifest runtime before `npm ci`, and npm's
  source-tree `devEngines` check refuses a direct install under a different Node version. The
  portable manifest record is validated by the same JavaScript contract used for the build-runtime
  probe, avoiding shell-specific JSON parsing. The shipped runtime support range is unchanged. The
  fresh build reached the root native rebuild without the thin-LTO flags or `LNK1117`, then stopped
  on the separate `node-pty` `MSB8040` caused by a Visual Studio 18 Spectre-library mismatch. The
  bootstrap now selects one exact C++ installation whose default toolset owns matching Spectre
  libraries, passes that installation to node-gyp through `VCINSTALLDIR`, and makes preflight check
  that exact active toolset instead of accepting any older mitigated directory. A fresh
  `build.bat /s` completed `npm ci` and the full native rebuild, then the later source build stopped
  on a pre-existing duplicate declaration in `scripts/check-personal-vocabulary-coverage.mjs`. The
  ultra-speed pass intentionally runs no tests, type checks, lint, reviews, audits, runtime
  interaction, or screen captures.

- Consolidate the malformed TypeScript merge recovery into the combined recovery pull request.
  The implementation lane repairs parser-invalid remnants across core services, host and bridge
  code, renderer surfaces, shared contracts, account and identity handling, and release workflow
  wiring. It also adds the source-parse validation path and aligns the Windows installer contract
  with the unsigned Squirrel.Windows packaging policy. This recovery record is intentionally
  unverified until the parent integration lane completes its parser, type-check, build, packaging,
  and release-workflow checks. The ultra-speed pass does not run tests, reviews, accessibility or
  security checks, runtime interaction, or screen captures after activation.

- Load pull requests for the attach guide through the typed `pull-request.list` capability with
  bounded pagination and provider head-ref facts. Open an attached chip or frame pill in the in-app
  Markdown detail and review surface, with an explicit secondary link to GitHub. Partial and
  unavailable provider states remain visible. No tests, lint, typecheck, builds, packaging, reviews,
  audits, runtime interaction, or captures were run in this ultra-speed lane.

- Mark a pull-request list as partial when the provider continues beyond the three-page, 300-item
  bound or when local result truncation occurs, even if the provider response omits its partial flag.

- Add a guided attach and adopt surface for GitHub work items. Terminal and owning-frame context
  menus now open a searchable provider-backed picker with a review step, exact frame adoption, and
  explicit legacy-card conversion that preserves the complete record. No tests, type checks, lint,
  builds, packaging, runtime interaction, reviews, audits, debugging, repairs, or captures were run
  in this ultra-speed lane.

- Replace newly created standalone GitHub work-item canvas nodes with compact issue and pull-request
  attachments: chips stay on their exact session node, pills stay on the owning frame, and pull-request
  frame adoption requires an exact match between provider head ref and app-owned worktree branch.
  Existing detail nodes remain lossless legacy records. No tests, builds, packaging, runtime interaction,
  reviews, audits, or captures were run in this ultra-speed lane.

- Use a bounded Node HTTPS stream for the production immutable icon download, retaining the
  fetch-style injection seam for tests. The wrapper rejects redirects and invalid status or length,
  stops oversized or stalled responses, compares exact bytes, and reports each source-icon phase.
  No tests, builds, packaging, or captures were run for this repair.

- Make the Windows Squirrel wrapper await its complete asynchronous entrypoint and emit synchronous
  phase diagnostics through icon verification, application build, packaging, and contract checks.
  The unsigned policy and source-SHA icon verification remain unchanged. This repair was not tested,
  built, packaged, or captured in the ultra-speed lane.

- Preserve a custom agent's selected builtin harness on its node so capability and icon resolution
  survives removal of the mutable settings record.
- Route custom harness capability checks through the shared hook, resume, pane, and launch helpers.
- Document the host-owned executable, profile, argument, environment, working-directory, and secret
  boundaries for custom agent launches.

- Add project-aware single-node canvas focus for issue #86. The terminal header, command palette,
  and desktop F11 path now promote one node into a transient canvas, merge edits back into the full
  project, restore nested coordinates and the parent viewport, and refuse missing or unavailable
  targets without inventing a destination. This lane did not run tests, type checks, lint, builds,
  packaging, runtime interaction, reviews, audits, or captures.

- Add viewport-relative canvas zones and named saved layouts. Nodes can preview and snap into half,
  third, or quarter regions while dragging, and a saved arrangement restores portable geometry and
  the camera without carrying sessions, credentials, process state, or machine paths. This
  ultra-speed lane intentionally did not run tests, type checks, lint, reviews, security or
  accessibility checks, builds, packaging, installer execution, runtime interaction, or captures.
- Add opt-in Claude account rotation for new default sessions. When the selected account reaches the
  configured usage threshold, the launch funnel chooses the configured account with the most
  headroom, preserves explicit account picks and running sessions, and fails safe when usage is
  unavailable. This ultra-speed lane intentionally did not run tests, type checks, lint, reviews,
  security or accessibility checks, builds, packaging, installer execution, runtime interaction, or
  UI captures.

- Mount the AWS CDK manager through the shared AWS resource node and AWS Shop. The guided route
  uses the existing local profile and region binding, a native project-folder picker, bounded
  trust review of `cdk.json` and dependency manifests, fixed synth and diff actions, stack search
  with an anchored regex builder, cancellation, and a reviewed deploy path with destructive
  confirmation for removal or replacement changes. Portable intent contains only safe app and stack
  intent. This issue #48 preparation lane did not run tests, type checks, lint, builds, packaging,
  runtime interaction, reviews, accessibility or security checks, or screen captures.

- Correct issue #103's Easter egg discovery route so all 60 entries are contextual and bounded.
  Removed keyboard chords, typed codes, Alt-click force discovery, and direct Try controls. The
  cabinet now contains discovery history and Reset discoveries only, while the 45-second cooldown,
  School-mode suppression, accessibility, reduced motion, ten funny levels, and local-only safety
  contract remain in place. This correction lane did not run tests, lint, type checks, builds,
  packaging, runtime interaction, reviews, audits, or captures.

- Add the managed no-socket Nextcloud hosting node with fixed PostgreSQL, Redis, and web services,
  persistent local data, generated secret files, loopback-only binding, bounded health and progress
  reporting, guided backup and restore snapshots, explicit update rollback sequencing, and no Docker
  socket or privileged mode. Machine-local paths and secret-key names stay out of portable project
  data. This ultra-speed lane intentionally did not run tests, type checks, lint, builds, packaging,
  runtime interaction, reviews, accessibility or security checks, or captures.
- Add Program 38 AWS platform-manager operations to the shared AWS ResourceNode: ECR, ECS, EKS,
  RDS, database, VPC, Route 53, and cost management. Typed previews, fixed argument arrays,
  bounded inputs and output, pagination, progress, cancellation, retry, local profile binding,
  portable safe intent, credential redaction, and destructive confirmation all reuse the existing
  manager. This issue #49 lane intentionally did not run tests, type checks, lint, builds,
  packaging, runtime interaction, reviews, accessibility or security checks, or captures.

- Add the generic all-service AWS operation route to the AWS Universe Shop. It reads installed CLI
  models, opens the shared schema-driven operation wizard with independent anchored regex searches,
  sends validated input through the shared AWS resource manager, previews fixed argv, bounds output
  and pagination, supports cancellation and progress, and uses destructive confirmation. No tests,
  type checks, lint, builds, packaging, runtime interaction, reviews, accessibility or security
  checks, or captures were run in this ultra-speed lane.
- Add the typed Cloudflare Tunnel inventory and route manager. It reads bounded tunnel, ingress,
  and DNS records, preserves existing routes, reports hostname conflicts, and supports explicit
  CNAME adoption or one-record replacement behind the existing two-key confirmation. Portable
  schema 3 intent excludes account, zone, tunnel, DNS ids, credentials, provider sessions, paths,
  caches, and live state. The ultra-speed lane intentionally did not run tests, type checks, lint,
  reviews, security or accessibility checks, builds, packaging, installer execution, runtime
  interaction, or UI captures.

- Add the review-first Cloudflare Tunnel wizard with populated account, zone, hostname, host,
  discovered container, network, port, and origin pickers. Each picker has isolated local search
  and an anchored regex builder; the host boundary receives only opaque selections, progress is
  cancellable, failures retain a recovery preview, and local provider credential binding stays
  separate from schema 3 portable intent. This ultra-speed lane intentionally did not run tests,
  type checks, lint, reviews, security or accessibility checks, builds, packaging, installer
  execution, runtime interaction, or UI captures.
- Add guided `cloudflared` connector runtimes for a per-user process, an owned Windows service,
  and a pinned Docker connector. The main process validates discovered executables, contexts,
  networks, tunnel references, and generated ownership names; invokes fixed argument arrays with
  bounded progress and health; stores tunnel credentials locally; materializes only short-lived
  token files; and keeps portable schema 3 intent free of paths, credentials, process state, and
  host identifiers. Tests, type checks, lint, reviews, security or accessibility checks, builds,
  packaging, installer execution, runtime interaction, and captures were intentionally not run in
  this ultra-speed implementation lane.

- Add the tunnel state model for six independent observations: API creation, DNS routing, connector
  health, Access policy, origin reachability, and external reachability. The shared model uses
  bounded, timestamp-ordered transitions with honest `unknown`, `pending`, `ready`, `failed`, and
  `blocked` states, plus source and evidence for each observation. The Cloudflare core stack now
  exposes local state, generation fencing, cancellation, bounded probe expiry, typed IPC, and
  Desktop/Server Edition parity. Schema 3 carries only safe route intent, while provider ids,
  connector ids, process state, local paths, and live observations remain local. The guided state
  panel mounts in the Cloudflare manager with separate plain-text search and status filtering, each
  with its own adjacent anchored regex builder. Current tunnel-specific probes remain visibly
  unavailable or unknown until their adapters exist. This ultra-speed implementation lane
  intentionally did not run tests, type checks, lint, reviews, security or accessibility checks,
  builds, packaging, installer execution, runtime interaction, or captures.
- Add a guided hosted-service Cloudflare Tunnel handoff that verifies a loopback origin before any
  external change, requires explicit exposure confirmation, keeps provider credentials and runtime
  identifiers machine-local, checks provider capabilities before enabling the action, and reports connector and external reachability as separate states. The
  ultra-speed lane did not run tests, type checks, lint, builds, packaging, reviews, security or
  accessibility checks, installer execution, runtime interaction, or captures.
- Add guided Kiosk and PWA browser sessions. Schema 3 stores only validated secure target intent,
  display name, mode, and requested permission names, while browser profile state, grants, cookies,
  process state, and host identifiers remain local. Kiosk sessions deny popups and insecure targets;
  PWA sessions require a real installed-app inventory and show an honest unavailable state when it
  is missing. Exit, Retry, ownership checks, and lifecycle failure states are explicit. This
  ultra-speed lane intentionally did not run tests, type checks, lint, reviews, security checks,
  accessibility checks, builds, packaging, installer execution, runtime interaction, or captures.
- Add a read-only Windows diagnostics canvas node with fixed PowerShell queries for drives and
  storage, services, startup entries, scheduled tasks, updates, network state, and bounded event
  summaries. Each section has guided tabs and a local filter with an adjacent anchored full regex
  builder, while unavailable and malformed host responses remain explicit. No tests, type checks,
  lint, reviews, security or accessibility checks, builds, packaging, installer execution, runtime
  interaction, or UI captures were run in this ultra-speed lane.
  The lane was later reconciled with `origin/main` at
  `54164b84dce0b7e62787b1de2885405ff4ed821c`; the reconciliation merge was recorded on its feature
  ref and does not change the no-check verification boundary.
- Add the opt-in **Seamless agent messaging** setting. With it off, agent `send` and `reply`
  requests use the existing confirmation surface; with it on, they use the same guarded mailbox
  delivery path without the repeated per-message decision. Project capability consent, idle-target
  checks, flow limits, delivery traces, bounded queue outcomes, and confirmation for node closing
  remain unchanged. The bounded hook `CONTROL_CEILING_MS` is preserved. This ultra-speed lane did
  not run tests, type checks, lint, reviews, security or accessibility checks, builds, packaging,
  installer execution, runtime interaction, or UI captures.
- Add per-account default node colours for managed Claude and Codex accounts. Settings exposes
  shared colour swatches, new nodes capture the owning account's colour at creation, and phone-
  registered nodes use the host-resolved account colour. Claude and Codex account ids are resolved
  against their own lists, malformed or empty values fall back to the builtin agent colour, and
  existing nodes remain unchanged. This ultra-speed lane intentionally did not run tests, type
  checks, lint, reviews, security or accessibility checks, builds, packaging, installer execution,
  runtime interaction, or screen captures.

- Add per-session emoji or local image icons. Terminal session icons are validated at both project
  serialization seams, copied through the durable canvas-image writer, stored portably when the
  project has a local folder, and rendered consistently in the canvas header, Kanban card, card
  modal, and sessions sidebar. This source-only Program 61 lane intentionally did not run tests,
  type checks, lint, builds, packaging, installer execution, runtime interaction, security or
  accessibility checks, reviews, or UI captures.
- Add the first-class Files node from upstream PR #294. Each node keeps one persisted directory
  listing on the canvas with breadcrumb navigation, filtering through the shared anchored regex
  builder, file and folder creation, path copy, local file-manager reveal, file routing, and a
  terminal-in-folder action. SSH and relay listings stay on their owning filesystem, worktree
  removal displaces stale directory nodes, and remote paths never reach the local operating-system
  opener. This lane intentionally did not run tests, lint, type checks, builds, packaging, runtime
  interaction, reviews, audits, security or accessibility checks, or UI captures.
- Add display-only agent-state recovery and workflow-state sidebar grouping for issue #74. The
  lifecycle-bound snapshot keeps the last known Claude, Gemini, or Codex state available after a
  restart while expiring operational evidence remains separate. Recovered state cannot trigger
  notifications, authorization, process control, or hibernation, and fresh hook events take
  precedence. Unread remains a row-level affordance, so completed and unknown sessions stay in
  their workflow sections. This ultra-speed lane did not run tests, type checks, lint, builds,
  packaging, runtime interaction, reviews, security or accessibility checks, or captures.
- Add optional labels and bounded editable line thickness to canvas annotations. Labels, stroke
  widths, variants, and diagonals now persist through ordinary project files and schema 3 portable
  projections with validation at the import boundary. Issue #76's ultra-speed lane intentionally
  did not run tests, type checks, lint, reviews, security or accessibility checks, builds, packaging,
  installer execution, runtime interaction, or UI captures.

- Add user-named terminal profiles for the upstream #286 workflow. Settings now stores a bounded
  name, initial directory, and optional startup command, with a native folder picker, local search,
  edit/remove/default controls, and creation-time selection for terminal and agent nodes. Stable
  ids remain in the machine-local execution overlay, while paths and commands stay out of portable
  project files and peer traffic. Tests, type checks, lint, builds, packaging, runtime interaction,
  and captures remain unrun under the Program 66 issue boundary.
- Add independent custom alert sound files for finished-agent and needs-attention events. Settings
  → Notifications now validates bounded local audio, stores the bytes in app data so Server Edition
  can replay them on its host, provides per-event preview and reset controls, and falls back to the
  built-in cues whenever a custom file is missing or cannot be decoded. This ultra-speed lane did
  not run tests, type checks, lint, reviews, security or accessibility checks, builds, packaging,
  installer execution, runtime interaction, or UI captures.
- Add bounded nested Git repository discovery to Source Control. Projects whose configured folder
  contains child checkouts can select each verified repository as an independent scope, while
  unreadable scans remain distinct from an empty result and SSH projects retain their explicit
  remote limitation. Results are paged with an opaque cursor, capped at 512 scanned directories,
  and guarded against symbolic-link and Windows reparse-point traversal. This ultra-speed
  implementation lane intentionally did not run tests, type checks, lint, reviews, security or
  accessibility checks, builds, packaging, installer execution, runtime interaction, or UI
  captures.
- Add a bounded typed link endpoint model for canvas relationships. `Endpoint` now distinguishes
  local nodes, foreign project-node references, and repository-relative branches, while `Link`
  carries one explicit relationship kind and project-owned source semantics. The shared validator
  rejects malformed or non-portable records, unsafe metadata, foreign mutation sources, duplicate
  ids, and oversized collections. This issue #86 model lane did not run tests, type checks, lint,
  builds, packaging, runtime interaction, reviews, accessibility or security checks, or captures.
- Migrate legacy `bridges` and `ropes` project-file arrays into the unified typed `links` collection.
  Bridge ids remain context links, rope ids remain display-only lineage links, and new saves emit
  only `links`. Inline projects, cached SSH content, and persisted canvas snapshots use the same
  idempotent conversion. The issue #86 and upstream PR #422 migration lane was reconciled with
  `origin/main` at `54164b84dce0b7e62787b1de2885405ff4ed821c`. This source lane did not run tests,
  lint, type checks, builds, packaging, runtime interaction, reviews, audits, or captures.
 - Add the cross-project link transport and storage slice for issue #86 and upstream PR #422. The
  Canvas-owned commit funnel keeps live link state and persisted `Project.links` together, while
  background-project context transport accepts only local node-to-node context links. Branch,
  dependency, lineage, and foreign-node behaviors remain in their dedicated lanes. This source lane
   intentionally did not run tests, lint, type checks, builds, packaging, runtime interaction,
   reviews, audits, or captures.

- Add repository-aware session grouping and reversible canvas drill-through for issue #86. The
  sidebar now groups projects by resolved repository root, keeps local and SSH project identities
  separate, exposes active-repository unbound worktrees as bindable rows, and preserves the existing
  project and group ownership callbacks. Group frames can open a temporary child view whose edits
  merge back into the complete parent snapshot without dropping siblings. Safe `projectRef` intent
  supports linked-project drill-through with muted unavailable and closed targets, normal project
  travel, and a breadcrumb return route. Implementation commit:
  `451605b314c709da56c67bc176c78424898ecc26`. This lane did not run tests, lint, type checks,
  builds, packaging, runtime interaction, reviews, audits, or captures.
- Add the guided same-repository branch dependency operation contract for issue #86. Project-owned
  branch links now have bounded plans for setting and clearing parents, rebasing a child, proposing
  a pull request against its parent, and fast-forward shipping into the parent checkout. The typed
  Git service and bridges expose queued, running, completed, failed, cancelled, and unavailable
  states, reject cross-project or mismatched-link requests, bound paths, refs, arguments, and output,
  and never accept arbitrary shell text. This source lane intentionally did not run tests, type
  checks, lint, builds, packaging, runtime interaction, reviews, audits, or captures.
- Harden per-node model switching against stale menu callbacks. A request for the model the node
  already runs now refuses before foreground termination or session recycling, preserving the
  active conversation. The source implementation and documentation records were updated in this
  lane; tests, type checks, lint, reviews, builds, packaging, runtime interaction, and UI captures
  were intentionally not run.

- Mount the seven AWS core-service routes on the shared AWS manager: S3, EC2, IAM, STS, Lambda,
  CloudWatch, and CloudWatch Logs. Typed operation controls now cover bounded reads, selected writes,
  destructive confirmation, pagination, cancellation, and progress while reusing the current local
  profile, region, endpoint, and verified AWS CLI seams. STS is limited to caller identity and never
  returns session credentials. Project data carries only safe intent. This issue #46 preparation
  lane did not run tests, type checks, lint, builds, packaging, runtime interaction, reviews,
  accessibility or security checks, or captures.

- Extend the special-universe Shop with the complete AWS catalog inventory: identity, Resource
  Explorer, Cloud Control, S3, EC2, IAM, STS, Lambda, CloudWatch, CloudWatch Logs, CloudFormation,
  CDK, ECR, ECS, EKS, RDS, databases, VPC, Route 53, cost management, and all-service rows. The
  AWS projection is scope-bound, revalidates selected entries at creation time, and keeps every
  later-wave executor visible with its exact disabled reason. The issue #40 ultra-speed lane did
  not run tests, type checks, lint, security or accessibility checks, builds, packaging, runtime
  interaction, or captures.
- Add portable Comments and Activity attachments for generic files plus image, audio, and video
  previews. The composer now has picker, drag/drop, and paste routes, a removable validation queue,
  bounded byte-signature detection, transactional board-log storage, remote-safe atomic writes, and
  schema 3 archive carriers with hash, length, name, kind, and reference validation. This issue #94
  implementation lane intentionally did not run tests, type checks, lint, builds, packaging,
  runtime interaction, reviews, security or accessibility checks, or captures.

- Add upstream-compatible agent-to-agent drag collaboration for issue #90. A bounded,
  namespaced collaboration handle links two existing context-capable agent sessions through the
  existing Context Link path. Valid targets show an honest Material Design 3 drop state, while
  keyboard, touch, and screen-reader users can activate two link buttons or use **Link selected
  agents**. No process, account, credential, project, working-directory, or conversation-transfer
  state moves. This implementation lane intentionally did not run tests, lint, type checks, builds,
  packaging, runtime interaction, reviews, audits, or captures.

- Add the context-window progress meter to every agent-backed node and session surface. Provider
  telemetry is source-scoped and generation-fenced, exact values are shown only when reported, and
  unknown, not-reported, stale, and unavailable states remain visible. Local and remote transcript
  reads are bounded and machine-local. This issue #89 implementation lane intentionally did not run
  tests, lint, type checks, builds, packaging, runtime interaction, reviews, audits, or captures.

- Add first-class Cognition Devin CLI support from the measured `devin 3000.4.25 (7e8e528a)`
  contract: builtin registry and mark, argv/interactive prompt forms, prompt-file and print
  helpers, resume and continue commands, project-level `.devin/hooks.v1.json` lifecycle hooks,
  structured status normalization, and BEL/OSC notification fallback. Context usage, permission
  control, titles, subagents, transfer, canvas control, and structured transcripts remain explicitly
  unavailable until measured. The real Devin CLI was not available, so this ultra-speed lane ran no
  tests, lint, type checks, builds, packaging, runtime interaction, reviews, audits, or screenshots.
- Add a shared 40 ms burst budget for plain-wheel canvas zoom and a persisted 0.2×–2.0× wheel
  zoom speed control. The historical 1.0× feel remains the default; modifier zoom and trackpad
  pinch keep their fixed behavior. Hand-edited values are clamped at the point of use, and the
  Behavior setting explains its compiled-in, saved, or scheduled provenance in the active language
  mode and funny-level voice. This source lane intentionally did not run tests, lint, type checks,
  builds, packaging, runtime interaction, reviews, audits, or UI captures.
- Expand English and Cantonese funny-level controls from 1–5 to 1–10 for issue #113. New
  installations default both values to level 10, while settings schema version 2 preserves valid
  established choices and safely normalizes malformed hand-edited values. Scheduled settings,
  site-local storage, exports, provenance copy, and the Easter-egg and feature copy resolvers now
  accept the complete range. This source lane intentionally did not run tests, type checks, lint,
  builds, packaging, runtime interaction, reviews, audits, or UI captures.
- Route macOS desktop canvas wheel input from main-process trackpad gesture facts. A depth-safe
  ledger sends scroll and pinch edge transitions over typed IPC, the desktop router keeps a bounded
  500 ms momentum-gap linger, and precise-pixel mouse packets zoom when no gesture is reported.
  Server Edition keeps its documented browser heuristic and mobile remains not applicable. This
  issue #108 implementation lane intentionally did not run tests, lint, type checks, builds,
  packaging, runtime interaction, reviews, audits, or captures.

- Add the guided GitHub API capability surface. A hand-written operation catalog now covers
  repository, source control, collaboration, Actions, release, package, deployment, organization,
  account, search, security, ruleset, webhook, and app resources through fixed REST routes plus a
  fixed GraphQL account profile query. The host derives approved repositories, keeps credentials out
  of the renderer, bounds pagination and response data, reports progress and rate limits, supports
  cancellation, and requires operation-scoped destructive confirmation. Tests, type checks, lint,
  reviews, security or accessibility checks, builds, packaging, installer execution, runtime
  interaction, and UI captures remain intentionally unrun for issue #101.

- Add the guided Nextcloud AIO hosting profile for issue #52. It uses a pinned official image,
  explicitly discloses read-only Docker socket authority, refuses privileged mode and arbitrary
  shell input, and provides local binding, health, update, backup, restore, rollback, cancellation,
  and progress states. Schema 3 carries safe intent only; Docker context, socket, host paths,
  container state, backup data, and credentials remain local. This ultra-speed lane intentionally
  did not run tests, type checks, lint, reviews, security or accessibility checks, builds, packaging,
  installer execution, runtime interaction, or captures.

- Rebuild the README from the ground up around the current Windows delivery path, genuine product
  captures, explicit evidence boundaries, and a compact top-level index. Keep 9 current key
  screenshots visible without disclosure controls, add 25 committed feature GIF recordings for
  the documentation site, remove stale non-Windows delivery references from the README and active
  site content, and verify every recorded file by exact hash with three deliberate negative
  regressions.

- Add the guided GitLab Server hosting node. Choose the pinned official Community Edition or
  Enterprise Edition image, create four managed volumes, probe readiness, hand off the initial
  root credential once without logging it, and run backup, restore, update, and rollback actions
  behind the existing confirmation flow. Binding is loopback-only and all Docker arguments are
  generated from typed controls. This ultra-speed lane intentionally did not run tests, type
  checks, lint, reviews, security or accessibility checks, builds, packaging, installer execution,
  runtime interaction, or captures.

- Add Windows `psmux` discovery to terminal persistence. Executable lookup now honors `PATHEXT`,
  prefers `tmux` and then `psmux`, uses the shared executable predicate for Windows Package
  Manager detection, and keeps the missing-multiplexer banner visible on Windows with an exact
  `winget install -e --id marlocarlo.psmux` action when available. The ultra-speed lane intentionally
  did not run tests, type checks, lint, reviews, security or accessibility checks, builds, packaging,
  installer execution, runtime interaction, or UI captures.

- Document Program 57 linked-agent inbox notifications and register the feature in the offline
  documentation bundle and the documentation site. The current source uses the upstream PR #98
  fixed app-authored prompt intent through authenticated main-process delivery, project capability
  consent, runtime pane ownership checks, flow limits, traces, and the bounded deliver-on-idle
  queue. This ultra-speed lane intentionally did not run tests, type checks, lint, reviews,
  security or accessibility checks, builds, packaging, installer execution, runtime interaction,
  or UI captures.

- Add typed Cloudflare Access, Zero Trust, Workers, Pages, R2, D1, and Queues managers. The canvas
  node uses guided pickers, local protected credentials, portable neutral intent, fixed API routes,
  bounded responses, progress and cancellation, anchored regex builders for each search, and the
  existing two-key destructive confirmation. This ultra-speed lane intentionally ran no tests, type
  checks, lint, builds, packaging, reviews, security or accessibility checks, installer execution,
  runtime interaction, or UI captures.
- Add Usage popover default account selection for issue #70 and Program 59. Local and SSH Claude
  identity rows now offer a real keyboard-accessible choice for future sessions, persist only the
  active project's default account, keep running sessions unchanged, and fall back to System when
  a saved identity is stale. This lane is based on origin/main
  54164b84dce0b7e62787b1de2885405ff4ed821c and recorded in commit 95e8eb8e19e4a568bf7286b35a9cdf789a6983ac.
  Tests, lint, type checks, builds, packaging, runtime interaction, reviews, accessibility checks,
  security audits, and UI captures were intentionally not run.
- Restore one coherent managed Codex account lifecycle and same-machine switching implementation.
  Duplicate account handlers, app-server readers, and rollout-link publication paths were removed;
  account-id validation, owner-bound reservations, no-overwrite hardlinks, rollback, and credential
  boundaries remain intact. This lane intentionally did not run tests, lint, type checks, builds,
  packaging, runtime interaction, reviews, audits, or UI captures.

- Add the bundled AWS CLI v2 dependency lane. Windows packaging now stages the pinned official
  `2.36.32` MSI, verifies its SHA-256, falls back through a verified local cache or canonical
  HTTPS download, extracts it into application-local storage, exposes the installed version, and
  inventories the installed service models through typed desktop and Server Edition bridges. The
  implementation and documentation lane intentionally did not run tests, type checks, lint,
  reviews, security or accessibility checks, builds, packaging, installer execution, runtime
  interaction, or UI captures.

- Harden the AWS CLI model documentation index against malformed source records, duplicate service
  tokens, missing required members, and unfamiliar future shape kinds. Bundle its feature article in
  the offline documentation corpus. This ultra-speed lane intentionally did not run tests, type
  checks, lint, reviews, security or accessibility checks, builds, packaging, installer execution,
  runtime interaction, or UI captures.

- Add an AWS Universe navigator and portal cards for unlimited AWS-only child canvases. Each
  instance receives a permanent scoped Shop, searchable guided controls, and portable schema 3
  intent without credentials, profiles, local paths, or runtime bindings. Tests, type checks, lint,
  reviews, security checks, accessibility checks, builds, packaging, installer execution, runtime
  interaction, and captures remain unrun under issue #39's ultra-speed boundary.

- Add the shared hosted-resource backup and restore framework. Versioned manifests now carry safe
  resource, edition, ownership, payload-hash, omission, and byte-budget evidence; bounded ZIP
  validation rejects unsafe paths and malformed payloads; staged operations report progress and
  cancellation; local publication is collision-safe and atomic; restore review and expiry-bound
   rollback contracts keep later hosting nodes from applying an unverified destination change.
   This ultra-speed implementation lane intentionally did not run tests, type checks, lint, reviews,
   security or accessibility checks, builds, packaging, installer execution, runtime interaction,
   or UI captures.

- Add the guided Cloudflare core manager node for accounts, zones, DNS, SSL/TLS, rulesets,
  redirects, cache, and analytics. Typed host operations use a fixed HTTPS API, bounded result
  bodies, safe previews, cancellation, local sealed credentials, explicit unavailable states, and
  destructive confirmation. Schema 3 carries only safe operation intent and never carries tokens,
  provider sessions, local paths, responses, or request state. Every result list has its own plain
  text search and adjacent anchored full regex builder. Tests, type checks, lint, reviews, security
  and accessibility checks, builds, packaging, installer execution, runtime interaction, and UI
  captures were intentionally not run in this ultra-speed lane.
- Add Browser Portal lifecycle ownership with guided isolated profile creation, profile reset and
  removal semantics, explicit canvas/modal guest ownership, safe schema 3 browser-profile intent,
  and local-only browser data. The implementation lane intentionally ran no tests, type checks,
  lint, reviews, security or accessibility checks, builds, packaging, runtime interaction, or UI
  captures.

- Refresh the Browser Portal documentation with the exact no-profile-borrowing boundary, guest
  process/window ownership, restart and crash recovery, bounded navigation states, and the honest
  Server Edition and mobile boundaries. This record-only pass reconciled against fetched
  `origin/main` `54164b84dce0b7e62787b1de2885405ff4ed821c` without rewriting the lane history.
- Add proxy and isolated debugging browser sessions with guided profile and proxy choices, explicit
  certificate policies, host-owned lifecycle and recovery, bounded redacted diagnostics, and a
  separate browser partition. Schema 3 carries only safe intent; credentials, certificates,
  executable paths, process state, cookies, and debugging data remain local. The ultra-speed lane
  intentionally ran no tests, type checks, lint, reviews, security or accessibility checks, builds,
  packaging, installer execution, runtime interaction, or captures.

- Complete the Express File Converter flow with queue-wide collision-safe destination names,
  visible rename disclosure, final atomic no-clobber publication, and a completed-output action that
  opens the exact result in Visual Studio Code through the active project API. The converter queue
  and all source/destination paths remain machine-local and absent from portable schema 3 projects.
  Tests, lint, type checks, builds, packaging, runtime interaction, and captures were intentionally
  not run in this ultra-speed implementation lane.

- Add a guided Docker host manager for local and saved SSH contexts. The canvas node now exposes
  searchable containers, images, volumes, networks, Compose projects, bounded statistics, redacted
  logs, fixed typed container tasks, cancellable lifecycle progress, and destructive confirmation.
  Main-process argument-array validation prevents renderer shell input, while schema 3 carries only
  safe neutral intent and keeps credentials, endpoints, paths, live ids, and process state local.
  The ultra-speed lane intentionally did not run tests, type checks, lint, reviews, security or
  accessibility checks, builds, packaging, installer execution, runtime interaction, or captures.

- Add a platform-free universe navigation policy that permits canvas transitions only through
  reciprocal entry and return doors, refuses tab, palette, history, and direct-selection bypasses,
  and records only safe paired-door intent in schema 3. No tests, type checks, lint, reviews,
  builds, packaging, runtime interaction, or captures were run in this ultra-speed lane.

- Add shared provider-account, sealed credential, OAuth PKCE callback, resource-discovery, and
  local-binding services across Desktop and Server Edition. The guided binding wizard now uses
  searchable account and resource pickers with adjacent regex builders and exact unavailable
  reasons instead of accepting hand-typed provider identities or resource references. Project
  import remains side-effect free. This ultra-speed lane did not run tests, type checks, lint,
  reviews, security or accessibility checks, builds, packaging, installer execution, runtime
  interaction, or UI captures.

- Add a Wild dim sum canvas node backed only by the canonical public catalog and published photo
  releases. It offers random selection, plain-text and anchored regex search, bounded progress,
  cancellation, retry, bilingual factual dish details, portable schema 3 selection state, and
  explicit offline/photo recovery without vendoring images. This ultra-speed lane ran no tests,
  type checks, lint, builds, packaging, runtime interaction, audits, reviews, or captures.

- Add the Home Assistant multi-instance client with machine-local instance registration, sealed
  write-only access tokens, explicit node binding, bounded REST and WebSocket entity discovery,
  cancellable progress, retry and recovery states, searchable instance/domain/entity pickers with
  adjacent anchored regex builders, and schema 3 safe discovery intent. Hosts, credentials,
  sessions, sockets, caches, and entity results stay out of portable projects. This ultra-speed
  lane intentionally ran no tests, type checks, lint, builds, packaging, reviews, security checks,
  accessibility checks, installer execution, runtime interaction checks, or UI captures.

- Add Home Assistant control nodes with machine-local sealed connections, real entity and service
  discovery, rich controls for common domains, a schema-driven fallback, cancellation, recovery,
  and portable selection intent that omits credentials, endpoints, caches, and host identity. This
  ultra-speed lane intentionally ran no tests, type checks, lint, reviews, security checks,
  accessibility checks, builds, packaging, installer execution, runtime interaction, or captures.

- Add Home Assistant sensor display nodes with guided Configure, Rebind, Adopt, Deploy, Locate
  Asset, and Leave Unbound routes; real entity discovery; value, binary, enum, gauge, trend, event,
  weather, calendar, and selected-attribute presentations; bounded machine-local observations;
  schema 3 portable display intent; sealed machine-local credentials; desktop and Server Edition
  host services; and an explicit relay refusal. This ultra-speed implementation lane intentionally
  keeps the last successful selected-entity observation visible and marked stale during a live
  outage, and intentionally did not run tests, type checks, lint, reviews, security checks, accessibility checks, builds,
  packaging, installer execution, runtime interaction, or UI captures.

- Harden advanced pipeline publication with a 512 MiB produced-output ceiling and a 4 KiB ZIP
  entry-name bound. Repair the issue lane's package manifest so the pinned PDF, OCR, and image
  dependencies remain installable as valid JSON. This source-only correction intentionally did not run
  tests, type checks, lint, builds, packaging, installer execution, runtime interaction, reviews,
  audits, or UI captures.

- Add bounded advanced file pipelines to the existing guided converter: packaged PDF inspection,
  text extraction, split, merge, first-page extraction, reverse ordering, page rotation, and
  metadata removal; supported Sharp image conversion; local
  English OCR with packaged language data; safe ZIP entry inventory; and deterministic JSON key
  ordering. Portable pipeline intent imports unbound and omits paths, credentials, sessions,
  process and host identity, caches, and generated output. Audio/video and other formats without a
  packaged adapter remain visibly disabled. This ultra-speed lane intentionally did not run tests,
  type checks, lint, builds, packaging, installer execution, runtime interaction, reviews, audits,
  or UI captures.

- Add scoped Multiverse child canvases with a searchable hierarchy navigator, a guided searchable
  parent picker, exact depth-8 refusal reasons, independent viewport and graph state, deterministic
  scoped Shops, ordinary project persistence, and portable schema 3 projection. Import validates
  hierarchy structure and reconstructs data without launching external work. Tests, type checks,
  lint, builds, packaging, reviews, audits, runtime interaction, and captures remain unrun under
  issue #33's ultra-speed boundary.

- Add a portable top-down recovery game node with three energy keys, hazard reset behavior, central
  core activation, keyboard and button controls, board-location search with an anchored regex
  builder, explicit disabled-state guidance, and bounded schema 3 state that imports without
  external side effects. Runtime, build, and capture verification remain pending in the integration
  lane.

- Add a source-only desktop Material Design 3 audit with a hand-written inventory of 212 rendered
  surfaces, including onboarding, profile picking, conversion, password management, Minecraft
  management, dialogs, find bars, and notifications. Shared NumberField, Radio, Progress, and Tabs
  primitives now carry tokenized focus, reduced-motion, sizing, orientation, and state behavior.
  Personal vocabulary producer coverage is inventoried across 34 mapped renderer boundaries plus
  34 classified production surfaces, with 31 direct call-site mappings still open. Local-only
  replacements keep commands, paths, identifiers, external records, and user input exact. No
  general tests, builds, packaging, runtime launches, or captures were run in this source-only lane.

- Fix desktop renderer layout overflow across menus, flyouts, anchored popovers, dialogs, settings,
  onboarding, command palette, and documentation surfaces. Long localized and user-renamed values
  now wrap, dynamic collections scroll inside viewport-bounded surfaces, submenu flyouts are
  portaled outside the root scroll body, anchors remain reachable, and narrow settings rows stack
  without horizontal clipping. Source regression coverage was added for long roots with submenus
  and taller-than-viewport anchored surfaces. Built-artifact capture verification remains pending
  in the integration lane.
- Fix the WSL instance creator so installation has operation ids, bounded staged progress,
  cancellation, duplicate-submit refusal, and stale-progress fencing. Replace the legacy WSL
  prompt chrome with a guided Material Design 3 dialog that keeps WSL creation separate from the
  Linux ISO VM installer. Focused implementation verification remains pending in this lane.
- Contain the existing-worktree picker inside its Material surface: the adoption list now scrolls
  within its own bounded region, filters visible branch and path text through a plain-text-first
  search with an adjacent anchored regex builder, retains its title and actions, and clips row
  overflow at narrow viewports while wrapping full branch and path values. Source-only repair is
  present; built-artifact verification remains pending.

- Add the shared automatic node-dependency foundation: an explicit manifest, canonical HTTPS
  sources, SHA-256 verification, reusable machine-local cache, bounded download and extraction,
  atomic user-scoped publication, health probes, cancellation, repair, restart reconciliation, and
  typed desktop/Server Edition IPC. Node Catalog `Install and continue` resume wiring and focused
  verification remain the next integration points.
- Add a hand-written Material Design 3 audit for every Windows desktop surface and every checked-in
  documentation page, with a fail-closed source checker and shared numeric, radio, progress,
  keyboard-roving tabs, tooltip, and shape-token remediation. Built-artifact clipping and pixel evidence remain pending;
  the documentation and landing site stays in its existing Kids-mode visual style.
- Complete the schema 3 portable media source path: the typed desktop bridge now prepares
  path-free decision candidates, Include requires parser-proved media facts, selected bytes are
  content-addressed under `assets/media/`, and import validates and stages the real bytes before one
  atomic destination rename. Tests, type checks, lint, reviews, security and accessibility checks,
  builds, packaging, installer execution, runtime interaction, and captures remain intentionally
  unrun.
- Add schema 3 portable project import and export wiring with complete entry hash validation,
  bounded in-memory legacy migration, collision-safe atomic destination staging, cancellation,
  rollback, and an explicit omission report. Keep provider credentials, machine paths, process
  state, vaults, and local bindings out of the project file.
- Add the guided Desktop binding wizard with Configure, Rebind, Adopt, Deploy, Locate Asset, and
  Leave Unbound routes, local binding separation, progress and cancellation state, and an honest
  Server Edition desktop-only boundary. Verification remains pending by design for this lane.
- Add the unified Node Catalog registry and creation coordinator. The FAB, pane context menu, and
  command palette now expose a shared typed inventory with categories, safe defaults, availability
  reasons, local regex search, documentation links, immutable creation-event idempotence, and
  collision-free placement. This ultra-speed implementation pass intentionally did not run tests,
  type checks, lint, reviews, security or accessibility checks, builds, packaging, installer
  execution, runtime interaction, or UI captures. Build and packaging evidence proves artifact
  production only.

- Tighten Node Catalog creation semantics: append coordination now covers shortcut, profile, drop,
  paste, board, source-control, login, automation, duplicate, and peer paths; grouped placement
  compares siblings in one coordinate space; exhausted placement refuses visibly; remote terminals
  wait for a concrete picker selection; duplicate nodes receive fresh event ids; planned Photo,
  Gallery, Torrent, VM, Home Assistant, planner, universe, AWS, and hosting blueprints remain
  explicit disabled rows; and the offline docs bundle includes the catalog article. Verification is
  intentionally pending under the ultra-speed delivery boundary.
- Add the deterministic, non-deletable and non-duplicable Shop coordinator for Multiverse and AWS
  Universe child canvases. Scope-bound catalog filtering, import repair, hydration and peer
  idempotence, collision-safe identity, immutable creation-event handling, mutation refusal,
  portable safe metadata, and the accessible Material Design 3 Shop card are implemented. The Shop
  consumes a provider interface for the unified Node Catalog and remains creation-disabled until
  that dependency is available. Tests, builds, packaging, runtime interaction, and captures were
  not run under issue #17's explicit verification boundary.
- Add the issue #20 media catalogue and Photo, Video, and mixed-media Gallery canvas node kinds.
  Local media is routed through the existing allowlisted protocol, gallery references carry bounded
  portable metadata, and missing assets remain visible instead of disappearing. Machine paths now
  round-trip only through the local workspace index; schema 3 binds node references to validated
  content-addressed archive entries and re-proves byte count, signature, and SHA-256 before export
  or resolution. Verification is pending in the parent integration lane.
- Add the Torrent Downloader canvas node with ESM-compatible packaged or pinned user-scoped
  WebTorrent runtime discovery, explicit magnet and `.torrent` metadata inspection, searchable
  file selection and seeding policy pickers with anchored regex builders, safe destination
  preflight, explicit start/remove actions, progress/speed/peer/ETA reporting,
  pause/resume/cancel/retry, restart reconciliation, completion-based bounded seeding, and
  machine-local task persistence. The ultra-speed lane intentionally did not run tests, type
  checks, lint, builds, packaging, installer execution, runtime interaction checks, captures,
  audits, or reviews.
- Add a guided Linux ISO VM canvas node backed by bundled QEMU and qemu-img resolution, bounded
  memory/CPU settings, WHPX preference, loopback VNC/QMP lifecycle, persistent-install and
  disposable-live modes, machine-local ISO/disk bindings, snapshot controls, and network-off
  defaults. Ultra-speed implementation evidence intentionally excludes tests, builds, packaging,
  runtime interaction, and captures.
- Harden the Linux ISO VM lane with pinned QEMU dependency metadata, package-resource proof, WHPX
  probing with TCG fallback, ISO digest validation, qcow2/raw detection, disk free-space checks,
  QMP/display startup handshakes, bounded diagnostics, cancellation generations, stale-process
  recovery, atomic state retries, and a truthful Server Edition display boundary.
- Complete the Linux ISO VM integration by restoring parseable package and node-kind registration,
  closing the desktop and Server Edition bridge boundaries, mapping QEMU VNC display numbers to
  their real loopback TCP ports, allowing startup cancellation,
  surfacing QMP stop failures after bounded termination, and refusing to treat unreadable local VM
  state as an absent machine. Restore now selects from a searchable machine-local snapshot catalogue
  with an adjacent anchored regex builder, and the mode dropdown has its own isolated search and
  builder state.
- Add a host-owned planner occurrence service with durable local schedules, recurrence choices,
  timezone and DST semantics, cross-midnight descriptions, missed-occurrence history, JSON/CSV
  export, Desktop IPC and Server Edition WS-RPC events, and a guided Planner settings surface. The
  service now survives Desktop title-bar closure while enabled schedules exist, records each
  occurrence before notification delivery, preserves host-owned history across stale UI saves,
  exposes save retry recovery, and gates schedule deletion behind two-key confirmation.
  This ultra-speed lane intentionally leaves tests, builds, packaging, runtime interaction, and
  captures unrun.
- Extend planner occurrences with a validated schema 3 planner-definition projection and an
  explicit destination Configure action. Portable import carries schedule intent only, keeps
  occurrence history and host state local, and merges configured definitions without overwriting a
  conflicting destination schedule. The generated offline documentation bundle was refreshed from
  the planner article. Tests, type checks, lint, builds, packaging, runtime interaction, and
  captures remain unrun under the ultra-speed boundary.
- Add Calendar nodes for local calendars and ICS import, with guided CalDAV, Google Calendar, and
  Microsoft 365 provider/account/calendar selection, recurrence and timezone views, offline cache,
  create/edit previews, and destructive delete confirmation. Provider credentials stay behind the
  trusted shell's vault boundary. This ultra-speed lane deliberately ran no tests, type checks,
  builds, packaging, runtime interaction, or captures.
- Complete the Calendar provider boundary with verified HTTPS CalDAV account intake, loopback PKCE
  for Google and Microsoft 365, machine-local credential storage, bounded paginated synchronization,
  provider validators, retry backoff, and provider-confirmed event writes. Incremental provider
  updates now merge changed records and tombstones into the existing cache, and project-file
  boundaries strip unknown calendar configuration fields. This continuation ran no
  tests, type checks, lint, builds, packaging, installer execution, runtime interaction, reviews,
  audits, or captures.
- Add Alarm Clock canvas nodes with one-shot and recurring wall-clock schedules, explicit IANA
  timezones, daylight-saving-safe occurrence planning, snooze, dismiss, missed history, sound and
  narrator integration, and an honest no-powered-off-wake notice. Verification is intentionally
  pending in the ultra-speed lane.

- Add a deterministic schema 3 portable canvas projection for root and future universe scopes,
  preserving safe canvas presentation and relationships while rejecting machine-local and
  authority-bearing state. Archive integration and verification remain pending.

- Add the platform-free schema 3 portable-project manifest validator with canonical required
  entries, bounded raw and compressed budgets, deterministic SHA-256 metadata, safe path and
  collision refusal, omission reporting, and pure V1/V2 migration filtering. Verification is
  intentionally pending in this implementation lane.
- Publish the decision-complete plan for portable schema 3 project saves, universe Shop nodes,
  interactive AWS and Cloudflare managers, one-click hosted services, and the upstream parity
  program. This entry records planning only; no product implementation or release was made.
- Finalize published release notes with fail-closed workflow start/completion/duration evidence,
  link dim-sum photos at their public catalog release, and deploy Pages for every `main` push.
- Rebuild the app's chrome on Material Design 3: a new top app bar and project switcher replace
  the tab strip, a left nav rail with a FAB replaces the bottom dock, and every panel restyles
  onto the same token set. The default accent colour also changes for every existing install —
  see "Changed" below.
- Add Global mode and complete per-project Settings overlays through the shared settings surface.
- Make Windows shell-profile refresh and terminal preview use effective active-project Settings
  without saving sparse project values into global defaults.
- Fix the pre-push identity check to preserve complete Git revision argument vectors, so new
  branches exclude already-published ancestry while reserved-address commits still fail closed.
- Replace the paid remote-host prompt with a free Docker-hosted relay flow while retaining
  end-to-end encryption and mutual pairing approval.
- Run hosted relay terminals inside bounded, least-privileged, task-owned Docker containers with
  guided context/image/resource controls and deterministic teardown.

All notable changes to nodeterm are recorded here, generated from the project's
Git history. Each entry names the released version, its date, its categorized changes,
and the exact commit the release was built from.

This project has shipped very frequently during active development — commonly one
release per merged pull request. The 20 most recent releases are listed in full
below; earlier history is summarized and remains fully available via `git log`.

## [Unreleased]

Commits: [`7e965094`](https://github.com/eneskirca/nodeterm/commit/7e9650942c4e0fd08c4ac2857d43c36e539c347d) · [`84ef6d14`](https://github.com/eneskirca/nodeterm/commit/84ef6d1447d605194ea214175ec22a8d4a26a4a9) · [`d1f5d6f6`](https://github.com/eneskirca/nodeterm/commit/d1f5d6f607b4ac21088b8a169b73dd9f01119ea1) · [`7bc7585b`](https://github.com/eneskirca/nodeterm/commit/7bc7585bf22a3805cd71a1310aa3ff07ef1262de) ·
[`e041e3ac`](https://github.com/eneskirca/nodeterm/commit/e041e3acae1f38e1d86af35ed5f41489265f324c) · [`38e9ba3f`](https://github.com/eneskirca/nodeterm/commit/38e9ba3f4ffcbc01e873e5b18adbceab9b74ed39) · [`083b8fe1`](https://github.com/eneskirca/nodeterm/commit/083b8fe1da862e53e7b25ad32b74c7b39ec0b6f9) · [`59222942`](https://github.com/eneskirca/nodeterm/commit/59222942af3110004e7a8499630006a66fbf63c7) ·
[`3d23696c`](https://github.com/eneskirca/nodeterm/commit/3d23696c82204c492da7666e21c1e1981b6268a7) · [`29e118fb`](https://github.com/eneskirca/nodeterm/commit/29e118fb6f94bb7901547359ede12857579a1bb3) · [`540d6898`](https://github.com/eneskirca/nodeterm/commit/540d6898f4dc275c4753b8d3d7506ffe5635cf1d)

### Added

- **Deployment TOTP sign-in.** The desktop creates an owner-only TOTP secret for Server Edition,
  mounts it read-only into the container, shows the current rotating six-digit code, and the site
  accepts it through the same bounded lockout path as passwords with replay prevention.

- **Deployment-first device access.** The top-right device button now starts the local Server
  Edition container stack, automatically installs Docker Desktop through Windows Package Manager
  when absent, starts its daemon, builds the local image when needed, waits for health, and opens
  the site without a Pro plan or paid seat.

- **Automatic Java runtime provisioning for managed Minecraft servers.** The desktop app obtains
  the required Eclipse Temurin JRE in its private application-data cache, verifies Adoptium's
  published SHA-256, and uses it without changing the machine-wide PATH.
- **Per-project local history and portable project archives.** Every successful project save is
  snapshotted in its own app-data Git repository. A project and that complete history can be
  exported and imported as one bounded `.nodeterm-project` file.

- **Canonical upstream source pin.** `upstream/nodeterm` is now a real Git submodule pinned to
  `https://github.com/eneskirca/nodeterm.git`; `.gitmodules` records `main` for intentional remote
  updates, and the contributor guidance distinguishes the nested repository from the top-level
  remotes before a new gitlink is committed.
- **First-class Windows terminal profiles.** The desktop app detects PowerShell 7, Windows
  PowerShell, Command Prompt, Git Bash, every installed WSL distribution, and an advanced custom
  executable. One-click creation uses the saved default; profile-aware menus can snapshot an
  explicit choice per terminal or agent node, and headers identify the selected profile.
- **Restart with profile…** for Windows terminal and agent nodes, behind a destructive warning
  that the live process and persistent session will end before the node is recreated.
- **Material 3 design tokens.** A full `--md-*` role set and a six-step shape scale in both light
  and dark themes, mapped onto the app's own palette rather than replacing it. Nothing was renamed
  or removed, so no existing surface changes appearance from this alone.
- **Material Design 3 rewrite of the app's chrome and every panel.** Built on the token layer
  above: a new 64px top app bar (`TopAppBar`) carries the brand mark, the docked search bar, the
  presence facepile, and a `ProjectSwitcher` menu that replaces the old project tab strip
  (`TabBar.tsx` is removed outright, including its per-tab caret menu — now a per-row expandable
  actions panel in the switcher dropdown). An 88px left nav rail (`NavRail`) replaces the old
  bottom dock: its FAB (`FabMenu`) keeps the exact same node-creation menu and shortcuts, and the
  rail itself lists Canvas / Board / Files / Tools / Alerts / Settings as real flex-in-flow
  destinations rather than a floating overlay. Every restyled surface — the canvas nodes, the
  kanban board, Settings, the regex builder, every menu/dialog/toast, the welcome screen, session
  memory and local history — moved onto the same token set through a second stylesheet,
  `styles.md3.css`, layered after the existing `styles.css` and winning wherever the two
  disagree. Three font families now ship as locally bundled, subsetted `woff2` assets (Outfit for
  UI text, Roboto Mono for terminal/code, Material Symbols Rounded for icons via the new
  `MaterialSymbol` component) — nothing is fetched from a font CDN. This is a chrome and styling
  change only: every handler, keyboard path, persisted setting and `data-appearance-id` carried
  over unchanged.
- **Kids mode** — a friendlier, safer mode for a child, and the near-opposite of School mode: it
  keeps all the playfulness and adds limits instead. Agents cannot start in a mode that acts
  without asking, deleting a session from the board asks twice, and leaving the mode needs a
  grown-up PIN. It is shared across every app on the machine, renamable, and honest on screen
  about the one thing it cannot do — it does not sandbox the terminal.

### Changed

- Server Edition on phone-sized coarse-pointer browsers opens the full sessions/board experience
  and removes the Canvas destination; files, chats, tools, alerts and settings remain available.
- Payment checkout is disabled at the core boundary. License and paid-seat settings destinations,
  Pro upgrade dialogs and the Remote Access purchase gate have been removed.

- Mouse-wheel rotation now zooms the canvas by default, while dragging empty canvas pans it.
  Existing installations using the former untouched defaults migrate to the mouse-first behavior;
  both choices remain configurable.

- Windows profile ids are resolved in the trusted desktop core immediately before spawning.
  Executable paths and argv remain private; `terminalProfileId`, custom shell selection, and
  advanced SSH execution fields stay in the machine-local overlay and are stripped from shared
  project files, portable exports, and peer mutations.
- WSL profiles translate the project cwd through the exact selected distribution's `wslpath` and
  launch it with `wsl.exe -d <distribution> --cd <linux-path>`. Missing distributions and failed
  enumeration, translation, or launch now fail closed instead of opening a different shell or cwd.
- **Windows updates now use the protocol the Windows installer actually ships.** Packaged
  Windows builds use Electron's built-in Squirrel updater against the stable GitHub Release
  asset root (`RELEASES` plus the full `.nupkg`); macOS and Linux deliberately retain their
  existing `electron-updater` path. The Windows card reports Squirrel's download as
  indeterminate instead of inventing a byte percentage. **Restart now** is an explicit, one-shot
  action after the update is ready; a successfully downloaded Squirrel update can also apply on
  the next normal app launch.
- **Stable Windows releases are manual and `main`-only.** The release workflow no longer
  publishes feature-branch builds. A release tag is the stable package version, which advances
  from `0.3.0` to `0.4.0`. Automatic publication is disabled; the workflow remains manually
  dispatchable, but publication is pending the final packaged install/update interactions.
- **Windows `0.3.0` needs a one-time manual installer migration.** Its updater expected NSIS
  metadata from the old generic feed, which does not serve the Squirrel release set, so it cannot
  discover `0.4.0`; a manual `0.4.0` Setup is required. Closing `0.3.0` first is only a provisional
  recommendation: the real Windows proof must exercise Setup with the old app both closed and
  running before documenting the supported sequence. The isolated `0.4.0-fixture.1` → `.2`
  loopback proof separately exercises only the new updater code.
- Retheme onto the M3 roles: the canvas zoom/lock rail, the minimap frame, the bottom dock, the
  settings switch, the welcome screen, the notification centre and the command palette. Visual
  only — no layout, markup or behaviour changed, and every surface kept its full feature set.
- **The default accent colour changed from systemBlue (`#0a84ff`) to the Material 3 baseline seed
  purple (`#6750a4`) — this changes the appearance of every existing install, once.** Every
  settings file is written in full on every save, so an existing install's `#0a84ff` is
  indistinguishable from a deliberate choice; the one-time migration treats the old shipped
  default as "never touched" and carries it forward to the new default. systemBlue is not
  removed — it stays reachable as the second swatch in Settings' colour picker, one step behind
  the new purple default, so anyone who really did want blue can re-pick it in one click.
- **The nav shell replaces the tab strip and the bottom dock.** `TabBar.tsx` and `Dock.tsx` are
  deleted; their jobs move into the new `ProjectSwitcher`/`TopAppBar` and `NavRail`/`FabMenu`
  respectively (see "Added" above). The top app bar grows from 44px to 64px and a new 88px rail
  claims the left edge, so every floating panel that assumed the old geometry — the kanban
  overlay, the sessions sidebar and its icon cluster, the announcement/update banner stack, the
  presence prompt — carries a matching offset. The old floating top-right icon cluster
  (`.controls-cluster`) is gone: search, the presence facepile, notifications, phone pairing,
  dictation and help all moved into the top app bar; Explorer, Source Control, the file converter
  and the Ollama manager are now reached through the rail's Files/Tools destinations.

### Fixed

- The worktree creation dialog now applies the uploaded personal vocabulary to app-authored
  labels and guidance while keeping paths, branch names, refs, typed values, and Git errors exact.

- **Windows Python discovery now reuses the exact manifest-selected per-user installation before
  invoking an installer.** An explicit trusted `PYTHON` remains first, followed by
  `%LOCALAPPDATA%\\Programs\\Python\\PythonXY\\python.exe` and the pinned alternate toolchain
  target; candidates must pass the existing bounded version and architecture probe.
- Built-app screenshot launches now use a disposable home and Electron profile, verify the live
  `userData` path before interacting, and clean up only their own process and sandbox. Real-home
  sentinels now include both Kids and School mode records and credentials, preventing capture work
  from silently changing a PIN-protected mode.
- Windows terminals now retain session-host continuity across an app close, crash, and relaunch.
  A provisional or rejected attach is torn down, stays non-persistent, and reports its real reason
  instead of being indexed as a working persistent terminal or replaced by a throwaway shell.

 - The lazy Squirrel bootstrap no longer lets Vite move the main application graph under
  `out/main/chunks`, where its relative preload, renderer, HUD, and unpackaged icon paths pointed
  at files that do not exist. Main-process chunks now retain the `out/main` runtime boundary, and
  startup rejects a future nested layout explicitly instead of opening a blank window.
- Windows' previous updater expected NSIS metadata at a generic feed that did not carry the
  Squirrel artifacts produced by the release pipeline. Squirrel startup events are now handled
  before the main application graph loads, first-run checks wait for Squirrel's package lock,
  duplicate checks/installs are coalesced, and an offline or missing feed leaves the installed
  version running with an honest non-blocking error for user-requested checks.
- **Seven chrome highlights were frozen to the dark theme** and never followed the light theme or
  a user-chosen accent colour: the canvas lock button, the dock's active button, the welcome
  screen's remove-recent hover, the palette's secondary hover, the success and error toast icons,
  and an unread-row tint. All now derive from the real accent and danger colours.
- **Three contrast failures**, each measured with real backdrop compositing rather than compared
  as flat colours: the palette's secondary label (clickable text, was 4.41:1 in the light theme,
  now 5.87:1), the canvas lock glyph (was 2.87:1, now 5.34:1), and the destructive bulk-action
  button's border, which was effectively invisible at 1.56:1 and is now 3.20:1.
- Deleting a session from the board and from the canvas now ask the same way while kids mode is
  on. They had always differed — the canvas used the two-key confirmation, the board a single
  button — despite a comment claiming they matched.

### Tests

- Replaced the source-scanning shell regression with behavioural profile resolver, spawn,
  session-host attach/socket, settings migration, creation snapshot, and machine-local stripping
  coverage, including mutation checks for hostile ids, WSL fallback, and shared-state leakage.

## [0.3.0] — 2026-08-12

Commit: [`cd0441b8b48f32ec11f7b94d24d23239e93a8da7`](https://github.com/eneskirca/nodeterm/commit/cd0441b8b48f32ec11f7b94d24d23239e93a8da7)

### Added

- build the bundled tmux with utf8proc (correct emoji widths)
- bundle a static tmux in the macOS app as the last-resort fallback

### Chores

- v0.3.0 — bundled tmux fallback

## [0.2.47] — 2026-08-12

Commit: [`003f83791bf59116ec91859981a4cc4bdbe09faf`](https://github.com/eneskirca/nodeterm/commit/003f83791bf59116ec91859981a4cc4bdbe09faf)

### Fixed

- the panel reads phys_footprint on macOS, not ps's rss
- age the working park snapshot; correct the relay claim (#126)
- snapshot agent state at park time; review fixes (#126)
- gate the offscreen release on live work too (#126)
- never park-kill a working agent on a plain shell (#126)

### Documentation

- §10 — record the second-device measurements (items 5 partial, 6 re-verified)

### Tests

- darwin-gated behavioural guard — the default reader may never reap on bytes

### Chores

- v0.2.47

## [0.2.46] — 2026-08-12

Commit: [`90a8a29fc36bf40bc3c8e3a7573a73aee2a54ae9`](https://github.com/eneskirca/nodeterm/commit/90a8a29fc36bf40bc3c8e3a7573a73aee2a54ae9)

### Added

- session memory panel with travel and kill
- system-resource pill beside the usage pill
- session-memory store, polled locally and on demand over SSH
- resolve session rows to titles, projects and orphans
- real sessionMemory namespace for the Server Edition
- session-memory RPC, booted by both shells
- SSH leg for session memory, one sh round trip
- assemble the local session-memory report
- process-table reader and per-pane tree rollup

### Fixed

- the reaper must not cull on a byte watermark on macOS either
- a failed vm_stat is no signal, not a fall back to os.freemem()
- read macOS memory from vm_stat — os.freemem() reads ~0 there
- record hostDeviceId on entitled relay mints too
- restore the usage pill — the shell is SHARED, not the resource pill's
- the resource pill is an icon at rest, and sits left of usage
- the panel says whose memory it is, and the confirm says the node goes too
- the both-sockets fan-out is the panel's, not everyone's
- the SSH sweep must tell a broken tmux from an idle host
- a kill by NAME must try every socket that name could be on
- the panel's kill must reach the machine it is showing
- dismiss the session-memory panel on an outside click
- pin the coalescing key, and refuse SSH scopes on the server too
- an SSH project is a remote scope while DISCONNECTED too
- check marker ORDER in the remote session-memory parse
- anchor the no-server discriminator to tmux's own connect message
- read VmRSS, route ps through the seam, fail when no socket answered

### Documentation

- parseVmStat verified on a real Mac; sharpen why darwin stays silent
- renumber the checklist, widen two claims, and file the sidebar gap
- say what the kill actually covers, and correct three overstatements
- session memory pill + panel

### Tests

- the service's remote fixtures carry a socket fence
- pin the fit-view chrome opt-in and the panel's socket fan-out
- pin that killSessions runs every socket, every id, best-effort
- pin that the pill never runs the full sweep; one obstacle rect
- pin the SSH refusal end to end, and the index load it needs
- do not assert /proc/meminfo exists on the test host

### Chores

- v0.2.46

## [0.2.45] — 2026-08-12

Commit: [`0ba1f599980e7a586389d0f075972fe74fb4d3a9`](https://github.com/eneskirca/nodeterm/commit/0ba1f599980e7a586389d0f075972fe74fb4d3a9)

### Fixed

- patch node-pty's darwin fd leak locally (microsoft/node-pty#950)

### Chores

- v0.2.45

## [0.2.44] — 2026-08-12

Commit: [`9528d6a963b43bd2f277c2abc7f83796f7a327cd`](https://github.com/eneskirca/nodeterm/commit/9528d6a963b43bd2f277c2abc7f83796f7a327cd)

### Added

- relay the phone's priorDeviceToken into the relay-device mint
- warn before kern.tty.ptmx_max, and offer to raise it
- opt-in agent hibernation — exit idle offscreen CLIs, resume on view
- ptyShadowClients kill switch + swap logging
- hibernation policy + eco settings + status flags
- background writes into released sessions, no painter respawn
- control-mode shadows for released sessions
- control-mode client over pipes — zero pty devices
- memory-pressure responder chain (webgl + parks + early reaper sweep)
- tmux control-mode protocol codec
- two-signal memory-pressure monitor
- idle-reap the client PTYs of sessions nobody is attached to
- dispose offscreen terminals in place after 10 min; reattach on approach
- offscreen-dispose policy + offscreenTerminalMinutes setting
- browser Memory Saver — discard hidden webviews, restore from URL

### Changed

- hibernate registry beside the restart one
- split agent restart into exit + resume phases (behavior pinned)
- one shared hidden-discard hook, with its own coverage

### Fixed

- run the device pre-flight before the shadow swap-out, and pin its tests
- refuse spawns at the device ceiling before node-pty leaks another
- review fixes — real sweep allowance, safer fix handler, honest dismissal
- a Live Activity can no longer be left stuck on "Working"
- never defer a viewer release for a node that cannot hibernate yet
- final wave — one watched predicate, remote at plan time, hibernate before release
- pty.attach says whether it had to CREATE the session
- pin kill→dropStream adjacency; correct the %output-drop comments
- a SessionStart disproves the hibernated flag
- hibernation review round 1 — the second dismiss path, stale verdicts, self-heal
- refuse a non-positive hibernation idle window
- subtract a shadow from tmux's client COUNT, never force detached
- keep shadowed sessions cullable, and refuse what a shadow cannot reach
- silence the host memory leg on darwin (freemem lies there)
- refuse multi-line control-mode commands
- queue the pressure lever's releases through the drain
- only close a control-mode block on its own ts+num
- tmp hygiene parity — cleanup-on-failure + stale-tmp sweep
- ask the SESSION whether a node's core is remote, not the node
- unique per-call tmp names for atomic writers (#107)
- make the offscreen visibility observer outlive the dispose it reverses
- serialize agent.json and authorized_keys mutations (#106)
- name the machine pty-device limit in the spawn failure
- warn beside the QR when a dev build makes it LAN-only
- identify the restore echo by URL, not by a flag against a moving target
- never discard an audible page; keep a reveal from dirtying the workspace

### Documentation

- record why the fail-fast needs no retry backoff
- tmux control-mode shadow-clients plan
- record collapsed-node and respawn semantics of offscreen dispose

### Tests

- pin the shared client's attach log and the relay-path premise

### Chores

- v0.2.44

## [0.2.43] — 2026-08-11

Commit: [`b5ecd5110cb264af815b6a2c595b3155a3d3ee91`](https://github.com/eneskirca/nodeterm/commit/b5ecd5110cb264af815b6a2c595b3155a3d3ee91)

### Added

- tell the user when a corrupt index was backed up
- mint a node's session id instead of only learning it
- LRU count cap (12) on parked terminals

### Fixed

- do not revive a context another handler has already disposed
- notice when the atlas page dies with the GPU
- re-arm the drift rebuild on every fresh cell epoch
- read the context back after a reconcile that may have disposed it
- clamp the shared camera, so a stored zoom of 0 cannot blank the board
- answer an agent from ITS project's canvas, not the active one
- free whisper before quit — an in-flight transcribe was aborting the app
- cache the raw project.json bytes for self-write detection
- never mark edits clean that raced an in-flight save
- make in-place project reload actually reload
- never commit one project's canvas under another project's id
- auto-reload the window after a renderer crash
- cap remote subagent-tail reads at 1MB per tick, byte-safe via base64
- evict parks after the flush, not mid-switch
- cap subagent-tail reads at 1MB per tick, matching context-tail

### Chores

- v0.2.43

## [0.2.42] — 2026-08-10

Commit: [`4925d91c0dca5e48d8a66ad3749fdbb1f2ad1fc6`](https://github.com/eneskirca/nodeterm/commit/4925d91c0dca5e48d8a66ad3749fdbb1f2ad1fc6)

### Added

- advertise relay identity for late adoption; surface pairing relay result
- default phoneAccessEnabled on
- no copy pill for an agent that reports its own copies
- read SSH-possession push grants off the connected hosts
- gemini and opencode pulse their brand mark while working
- start gemini and codex sessions in the chosen permission mode
- adopt gemini's own session title, and split reading a title from renaming one
- "Zoom to 100%" in the command palette
- ask the host which nodeterm tmux sessions it runs
- copy receipt + selection hint in the card modal terminal
- fill the context meter for codex and gemini from their own transcripts
- copy receipt + one-time selection hint on the canvas node
- useCopyFeedback hook (drag + OSC 52 signals)
- pure copy-feedback decision module
- resync working agents when a reconnect re-verifies the hook tunnel
- resync a project's working agents against the host
- expose the currently-working nodes for the reconnect resync
- allow the in-place restart-and-resume for gemini nodes
- pure decision for whether a remote node is still working
- the RUNNING indicator is the brand mark breathing, not a critter
- make Context Link work in the Server Edition (#93)
- move nodes between frames + tidy inside a frame
- kanban board + card movement verbs
- brand logo in the agent menus, walking mascot on the badge and notch
- let grok sessions drive the canvas (skill discovery via ~/.claude/skills)
- allow the in-place restart-and-resume for grok nodes
- honor the permission-mode setting, and keep claude's version gate claude's
- two-way session-name sync via grok's own session metadata
- install grok status hooks on SSH hosts, under the host's GROK_HOME
- install grok's status hooks — badges, unread, notifications, notch
- normalize grok's hook dialect into the shared agent event model
- add Grok as a builtin

### Changed

- float the copy pill over the terminal, not in the header
- actually call the cell readout
- make the cell readout answer instead of throwing
- expose the cells a grid is actually drawn with
- move isShellCommand into shared so main can ask the same question

### Fixed

- serialize saves, unique tmp files, and empty-write guards
- report 'dev' relay status — an unpackaged build is not 'off'
- LAN-only pairings say so — QR hint, toggle-flip regeneration
- rebuild the atlas when its cell disagrees with a terminal's
- read the brand-logo map through Object.hasOwn, and correct two stale comments
- pin the claude-transcript gates, and stop the tooltip promising a search that is off
- stop the default permission mode auto-approving gemini's edits
- let a session self-heal onto the live SSH endpoint file
- count the copied body, not the newline stripped from it
- make codex's "ask each time" actually ask
- make the session-name sweep's read gate core's own default
- a rescue done that moved no badge fires no completion alert either
- the reconnect resync reads a 64 KB transcript tail, not 5 MB
- flip the "+ New session" menu up when it would fall off-screen (#100)
- fire the tunnel-verified hook after the entry is written, so the resync has a remote $HOME
- resync nodes the host is running, not only the ones still attached
- stop the codex/gemini meter and find bar reading claude's transcript
- stop mip-blurring text at a zoom that is barely under 1
- the font-weight setting reaches the shared renderer
- suppress the Copied pill when the clipboard toast fired first
- a throwing tunnel-verified hook can no longer fail the connect
- one node's failure is undecided for that node, not a project-wide abort
- an untrackable tool_use must not read as a finished turn
- a node waiting for permission no longer shows RUNNING
- ship the official mark, inlined so it follows the theme
- write the NUL separators as escapes, not raw bytes
- canonicalize the notification type, and correct four close-out residuals
- the routine per-tool permission prompt is not a NEEDS YOU
- make the mascot readable in the light theme and pin its art with real assertions
- put the permission-mode flag BEFORE the argv separator
- route the session-name sweep by agent, through one shared resolver
- heal a corrupt remote hook file, and make the GROK_HOME tests able to fail
- one $GROK_HOME rule, exact-string remote validation, node-side path module
- drop the inert raw-listener call and the dead remote-home clause
- report unknown Stop reasons, and match the asking notifications exactly
- grok takes a POSITIONAL prompt, behind a `--` separator

### Performance

- skip the host session listing when nothing is working, and ask decideFromPane directly

### Documentation

- correct four false claims, and retire the gemini "resume replay" story
- the gemini integration, its hook set, and the codex approval mapping
- record that the resync does not repair across an app restart
- design + plan for reconnect agent-state resync
- correct the comments the restart-target change made stale
- record the awaitingInput question main's codex fix raises
- fix the documented defects, and say where every claim comes from
- correct the comments this branch made false, and record the GROK_HOME trap
- the grok integration, its dialect traps, and the device checklist

### Tests

- cover the grok raw-listener branch in the Server Edition
- the renderer-side gate tests, omitted from the previous commit's file list

### Chores

- v0.2.42
- reduce the captured codex and gemini transcripts to what the tests read

## [0.2.41] — 2026-08-09

Commit: [`5ad6a629f4cb72087548b00d554e7bf7766f3af2`](https://github.com/eneskirca/nodeterm/commit/5ad6a629f4cb72087548b00d554e7bf7766f3af2)

### Added

- two-way GitHub Issues sync on the board (#90)

### Fixed

- bound every subprocess — an unbounded SSH probe was wedging terminals
- hold NEEDS YOU through codex request_user_input turn end
- add custom agents on a plain-http server

### Documentation

- describe the shapes, not the tool they came from
- a downloads badge that counts humans, not the updater
- drop the Gatekeeper caveat — the release IS signed and notarized

### Chores

- v0.2.41

## [0.2.40] — 2026-08-09

Commit: [`3e9c95a7fd2e61c8dcb4f95b41e6aa0b15473186`](https://github.com/eneskirca/nodeterm/commit/3e9c95a7fd2e61c8dcb4f95b41e6aa0b15473186)

### Added

- hold SPACE to pan, like Figma (#86)
- warm the light palette so it stops glaring

### Fixed

- the title is a name, not the whole header strip
- clicking a terminal focuses it, and clicking the pane releases the keyboard (#86, #87)
- never shrink a LETTER — italic text was rendering 16% small

### Documentation

- the README's iOS link pointed at a 404
- the tap step is not optional, and trust does not prompt
- the Homebrew cask was live but undocumented

### Chores

- v0.2.40

## [0.2.39] — 2026-08-07

Commit: [`98234810ef16bbf0dddf1819f5d1462272eec3f8`](https://github.com/eneskirca/nodeterm/commit/98234810ef16bbf0dddf1819f5d1462272eec3f8)

### Fixed

- a terminal that failed to SPAWN says so instead of sitting black
- top banners show the whole message instead of one clipped line

### Chores

- v0.2.39
- sync package-lock version with v0.2.37

## [0.2.38] — 2026-08-06

Commit: [`4d18673f74d1f6c11aa385da54abe849201c5089`](https://github.com/eneskirca/nodeterm/commit/4d18673f74d1f6c11aa385da54abe849201c5089)

### Fixed

- stop the browser pasting the PRIMARY selection on middle click (#84)
- render underlines — the SGR attribute and the hovered link
- AI commit message no longer spawns the agent in an SSH project's REMOTE cwd

### Chores

- v0.2.38

## [0.2.37] — 2026-08-05

Commit: [`eec630982df86201aa223a48e750fe65c01e58f3`](https://github.com/eneskirca/nodeterm/commit/eec630982df86201aa223a48e750fe65c01e58f3)

### Added

- auto now means the shared renderer on macOS
- the blink restarts on input, like xterm's own cursor
- survive a lost context — restore once, fall back if it happens again
- wire the blink phase into the addon — the cursor actually blinks
- the cursor blinks, and the idle park survives it
- the occlusion plate is a rounded quad, not a rectangle
- cursor styles, a wide-glyph cursor, and the outline a blurred terminal draws
- the feed reads decorations — search highlights are visible again

### Changed

- update gitignore
- name the author of a cell that holds a character and draws nothing

### Fixed

- a joiner's cursor lands where the PANE has it, not at the end of the paint
- shrink a glyph whose ink exceeds its cell instead of slicing it
- give the last line a guaranteed gap above the node's bottom edge
- measure characters on the same table as tmux and the CLIs
- a remote node is never spawned as a local shell
- a double-width character draws BOTH its cells, not just the first
- watch matchMedia for the dpr change, like xterm does
- a restore that never arrives falls back instead of stranding the canvas
- repack the cursor row when the inactive cursor style flips block-ness
- drop the deviceCellOf tie-break — xterm's device cell is already current
- rebuild the atlas when the display's pixel ratio changes

### Performance

- no frames while the kanban board covers the canvas

### Documentation

- the plate's half-side clamp is unreachable through the UI — say so
- the separate alpha blend fixes the mip-frontier rim — say so where it is set
- say what the top-layer skip really deviates from, and re-unify the subscription order
- Phase 2 plan — close the promotion gate, then make shared the macOS default

### Chores

- v0.2.37

## [0.2.36] — 2026-08-05

Commit: [`d15c7aae4e40b820d7b521a92bee112fe48718cd`](https://github.com/eneskirca/nodeterm/commit/d15c7aae4e40b820d7b521a92bee112fe48718cd)

### Added

- LINEAR magnification above zoom 1 — GPU-mode parity when zoomed in
- color-atlas wiring + the acceptance items parity now makes checkable
- the feed asks for colored glyphs; the addon survives atlas resets
- sample CoreText's pixels — RGBA atlas, mip chain, LOD-clamped minification
- rasterize glyphs in their real colors over their real background
- color-keyed atlas with reset-on-full and mip gutters
- experimental 'shared' renderer mode + device acceptance checklist
- TerminalNode shared-mode wiring behind the experimental flag
- shared layer — engine singleton, rAF driver, camera/z feed, DOM fallback paths
- renderer addon core + xterm attach shell
- pure viewport-row feed — colors, selection, cursor, wide/invalid cells
- visibility-scoped damage, disposeAll, stale-resize guard
- per-grid GPU buffers, row-range uploads, scissored occlusion plate
- inert disposed handles, gated setViewport, damage-safe frame errors
- dev harness — 40 synthetic streaming grids on one context
- engine — registry, damage, z-order, idle-quiet frames
- GlyphGL seam + WebGL2 instanced implementation
- offscreen-canvas glyph rasterizer
- monochrome glyph atlas
- packed cell instance format
- camera math

### Fixed

- re-measure the grid origin on node-chrome changes and on window focus
- draw the Misc-Technical line-art pieces geometrically — ⎿ keeps its foot
- snap geometric far edges to whole texels — geometry-path grout residual to zero
- source gutter extension from the last fully-covered texel; fractional-cell pins
- edge-extend slot gutters — full-bleed glyphs no longer grow grout seams
- guard the atlas reset against re-entrant repacks
- BLEND_GAMMA 1.45, and instrument the blank-glyph bug
- composite the coverage in linear light, not in sRGB
- give the rasterizer a backdrop — opaque atlas page, coverage off the red channel
- the z branch that actually runs is 'basic', and a test that runs the library
- the real z, the render-time answer, and the gestures the drag flag can't see
- glyph in the open, DOM when stacked — the overlap rule the canvas can keep
- close the double-corner elbow, and shades that are dither, not wash
- one stacking order for chrome and text, and glyphs the font can't be trusted with
- the plate is the node BODY, and the atlas sampler stops guessing
- a terminal is one renderer's, structurally — plus tests that can see a pitch/extent conflation
- 1:1 atlas texels, an opaque label row, and a camera that keeps up with the pan
- contain the generation fan-out, and close the Phase-1b review's doc gaps
- opaque xterm viewport, font-change cell drift, plate under-cover, respawn transparency
- a glyph-attached terminal is a transparent window onto the shared canvas
- selection-elevated grid z, announce every disposal, one failure funnel, no post-dispose frame
- stable dimensions object, loud restore failure, leaf-checked internals
- render the BASE character of a combining sequence, not the bare mark
- harness exercises overlap + upload granularity; drop a false tie claim
- final-review fixes — drawGrid doc, atlas-order pin, harness overlay
- harness must open under — and report — the full 40-grid load

### Performance

- park the rAF driver when the canvas is idle

### Documentation

- close the T7 review items — stale residual, EPS class, zoom-1 silhouette
- scope the edge-extension no-op claim to the actual source texels
- checklist names the TEXTURE_MAX_LEVEL failure signature and its one-line revert
- the plate measures the HOST, and the CSS coincidence that lets it
- device checklist — the sharpness float tie, and L14 (the atlas latches to the first terminal)
- explain the same-shape resize no-op

### Tests

- pin the cross-module contracts; atlas layout single-sourced + degenerate-page guard

### Chores

- v0.2.36

## [0.2.35] — 2026-08-04

Commit: [`11e49907a827c7d7e244755191eb15b7473154cf`](https://github.com/eneskirca/nodeterm/commit/11e49907a827c7d7e244755191eb15b7473154cf)

### Added

- enhance paste handling for images and text in browser
- compact the Terminal section, custom theme picker, per-section reset
- light appearance, following the terminal theme
- font picker with real installed-font detection, weights, contrast
- colour themes, cursor + spacing settings, one appearance source

### Changed

- route every surface and overlay through tokens

### Fixed

- show the New-project (welcome) screen above the board (#80)
- the surfaces the light theme missed, and a test so it can't recur
- ⌘M resolves the transcript it was actually asked for — and says so when it can't

### Chores

- v0.2.35

## [0.2.34] — 2026-08-03

Commit: [`1734ed0077ce7f579b7adb3f48cc7e55b523ae75`](https://github.com/eneskirca/nodeterm/commit/1734ed0077ce7f579b7adb3f48cc7e55b523ae75)

### Added

- serve the askpass relay on a 0600 unix socket
- spinner on every connecting state
- passphrase dialog, SSH connect polish and tab affordances
- prompt for passphrase-protected keys via an SSH_ASKPASS relay
- app-private ssh-agent so an unlocked key lasts one app run
- put a card's labels and priority/due/avatars on one row
- Notion-style board labels (create/assign, colors, filter)

### Changed

- gitignore update

### Fixed

- macOS defaults to the DOM renderer — WebGL becomes a deliberate opt-in
- the gesture latch — renderer swaps never run mid-pan/zoom, and drain as a trickle
- treat the webgl renderer swap as a transaction — verify, sweep, restore
- zoom-gated context suspension + lower macOS budget
- heal stuck blank/partial terminals after pan/zoom renderer churn
- place cursor-less new nodes in free space, not on a pile (#76)
- harden the askpass relay per socket-switch review
- alerts and Live Activities carry the node's CURRENT name
- label color picker didn't open (clipped by the list's overflow)
- a cancelled attempt must not defuse the key-forget it armed
- close four findings from the follow-up model bug hunt
- force exit after teardown when a SIGTERM quit stalls
- modal terminal's last row (a TUI status bar) was clipped

### Performance

- four quick wins from the performance audit
- cut startup payload and per-frame canvas work

### Documentation

- web-weight media — animated WebP + recompressed mp4s
- feature GIFs loop clean — drop the logo end card
- full video tour — hero + one video per feature row
- correct comments and harness README that lagged the design
- orca-style revamp — launch video hero + kanban feature tour

### Tests

- pin the connect dialog's browse-master teardown
- docker sshd harness with a containerized e2e suite

### Chores

- v0.2.34
- drop exports nothing imports
- use the mock keychain in NT_MULTI sandboxes
- badge NT_MULTI test instances on the macOS dock

## [0.2.33] — 2026-08-02

Commit: [`d4fe5b4c019bdb6ccacec0ba7f23a0bd7718b0cb`](https://github.com/eneskirca/nodeterm/commit/d4fe5b4c019bdb6ccacec0ba7f23a0bd7718b0cb)

### Added

- unify node tags into board labels + color-at-create + default view
- Notion-style board labels (create/assign, colors, filter)
- make relay remote access free — drop the Pro gate + monthly quota

### Fixed

- play SSH-project videos by caching the host file locally
- adopt a freshly downloaded model when the selection points at nothing

### Chores

- v0.2.33

## [0.2.32] — 2026-08-01

Commit: [`97a7daa4fe578ee940fada1d7b3b80d6fda7d2a9`](https://github.com/eneskirca/nodeterm/commit/97a7daa4fe578ee940fada1d7b3b80d6fda7d2a9)

### Added

- one-shot mobile-launch announcement card
- link the live App Store listing from every pairing surface

### Fixed

- tab caret menu flips at the viewport edges too (shared useMenuFlip)
- context menu flips away from the viewport edges

### Chores

- v0.2.32

## [0.2.31] — 2026-07-30

Commit: [`9bbb62df7312c2833c6fbce77ea12a2ba11d74a4`](https://github.com/eneskirca/nodeterm/commit/9bbb62df7312c2833c6fbce77ea12a2ba11d74a4)

### Added

- GPU-rendering toggle (escape hatch for macOS window flicker)

### Fixed

- gate the QR on Remote Login, working Open Settings, 10-min window
- resolve HOME in install-server.sh when systemd runs it without one
- frame /pair responses with explicit Content-Length

### Chores

- v0.2.31

## [0.2.30] — 2026-07-29

Commit: [`0c206a198645c4baae6f8009ed80c0bba458118c`](https://github.com/eneskirca/nodeterm/commit/0c206a198645c4baae6f8009ed80c0bba458118c)

### Added

- Add to / Remove from .gitignore in SCM and Explorer context menus

### Fixed

- "go to node" opens the CARD while the board is up
- Esc on an AskUserQuestion no longer leaves NEEDS YOU stuck
- answering on the desktop clears the card — a new ask settles the old one

### Chores

- v0.2.30

## [0.2.29] — 2026-07-28

Commit: [`40463a4f960d886c887cfbe599b010cd14507f24`](https://github.com/eneskirca/nodeterm/commit/40463a4f960d886c887cfbe599b010cd14507f24)

### Added

- publish the agent's session name host-side, so every reader sees a /rename
- paste a file into a terminal, not just drop it
- ephemeral cards get their own placement, selection and menu
- the usage popover opens on hover
- double-clicking empty canvas pulls back to an overview zoom
- a click on empty canvas returns from a double-click zoom
- frame a focused node against the free chrome rect
- say something while a remote account is being set up
- frame a focused node at 138% instead of 115%
- the download button reports its own transfer
- render PDFs in the platform's own viewer instead of as binary text
- scope the indicator to the project you are looking at
- read Claude usage on SSH hosts, without pulling their tokens
- download files off the machine the tree belongs to
- remember the card modal's comments-panel choice
- `verify` — a review panel over one node's work
- dependency edges — `--after` arms a node until its upstream is done
- choose which node-menu rows and header buttons are shown
- honour hidden-row settings in the node menu and terminal header
- fan-in — context-link spawned nodes + a `link` verb
- hideable-row inventory and visibility predicate
- reorder cards within a column by drag (drop-line + before/after)
- separate reattach from agent restart, add a header reattach button
- carry the "You: <prompt>" line to the phone
- node menu + bulk palette action to restart & resume agent CLIs
- terminal nodes register their in-place restart closure
- pane-command IPC — pane_current_command for restart choreography
- board polish — usage margin, macOS no-drag, menu icons
- in-place restart choreography, registry and bulk summary
- eligibility + exit-sequence helpers for in-place agent restart
- browser nodes on the board — cards + live webview in the card modal
- drop files into the card modal's terminal (shared drop path with the canvas node)
- a Notch settings section + a macOS step in the setup tour
- retro sound effects when a turn finishes / a session needs you
- usage pill over the board + right-click card menu (open / move / delete)
- dismiss a stuck row (hover × / right-click)
- DynamicNotch capsule — mascots live INSIDE the notch
- session budget — reap long-idle detached tmux sessions under memory pressure
- notch HUD — walking agent mascots beside the notch + mini panel
- edit your collaboration name/color from Settings
- desktop granted fallback + presence-aware alert deferral
- the host consumes phone read-acks; stale asks can't mute new ones
- daily auto-update timer + version surfaced to the phone
- reading a finished session on the desktop clears it everywhere
- make SSH remote projects free (remove Pro gate)
- context link works in SSH projects
- canvas-control skill works in SSH projects
- endpoint failover — a dead pipe falls back to a live server
- headless notification host — one-line install, zero open ports
- reverse-proxy SSO header trust (#29, Option B)
- opt-in 'pan' left-drag mode for empty canvas
- granted mode — the Server Edition pushes to SSH-possessed phones
- the RUNNING badge walks — agent mascots on working nodes
- branch quick-pick lists remote-only branches after fetch
- bump default terminal node size 600x400 → 640x440
- needsYou live-updates carry kind, question options and pendingId
- branch menu is a type-to-filter quick-pick
- hook-reply Approve/Deny — the decision IS the hook's answer
- question options + Live Activity update stream
- show upload overlay while a dropped file scps to an SSH host
- real UI in scenes, sequenced dictation, centered kanban, mobile step
- wire the live add-seats Payment Link
- new $10 Pro link + separate add-seats checkout URL
- first-run setup tour — info + interaction per step
- count every install via /v1/check; telemetry opt-out
- Pro includes 3 free team seats; extra seats $5/seat/mo
- card priority (low/medium/high/urgent) with chips and activity events
- Trello-style card metadata — members, due dates, dated activity feed
- context-window pill + popover in the card modal header
- send the node's display title so alerts lead with it
- relay guests read and write the host board with their own identity
- drop @anthropic-ai/claude-agent-sdk (−240MB bundled binary per platform)
- remove chat driver, IPC surface and SDK types
- center-anchored equalizer bars replace the VU dots in the capsule
- remove the SDK chat node — renderer + sticky tombstone
- header chat icon becomes comments — right flyout on the node, default-open panel toggle in the modal
- Usage section with per-provider toggles; regroup the sidebar (#18)
- recording pill matches the mobile capsule — live VU dots · Dictating… · red pause
- terminal actions in the card modal — search, dictate, AI-name, markdown view
- per-kind selection for mobile push events
- hold-to-talk — modifier-only chord records while held (v3)
- comments & activity panel in the card modal, event emission from the board funnels
- notify relay-paired phones over APNs on actionable agent events
- project-routed append/read/changed across desktop, server and ssh
- add the opencode provider, and generalize cookie storage (#15)
- append-only board history core + pure event diff
- add the MiniMax provider, with its cookie stored outside settings.json (#14)
- live viewer terminal in the card modal
- surface enabled providers in the pill, not just the popover (#12)
- viewer identity — one connection can hold multiple detachable views of a session
- add the Grok and Kimi providers (#11)
- feed Usages + Inbox to the companion through the agent-status mirror
- Trello-style card modal shell (scrim/Esc, rename, sticky editing)
- add the Gemini provider (#10)
- generalize to multiple providers and add Codex (#9)
- per-column + New session menu (agents/terminal/sticky); sticky notes are board cards
- read the generic limits[] contract, surfacing scoped model caps (#6)
- Trello-style tab toggle, board title strip, collapsible cards with meter detail row
- view toggle moves to the controls cluster; column half-pill on session nodes
- re-validate masters on wake instead of waiting out ServerAlive
- default dictation shortcut → Cmd+Alt+D
- livelier recording equalizer — faster poll, sqrt gain, per-bar silhouette
- mic button on the terminal node header — dictate into that node (dictation)
- session cards with Ungrouped column, live status badges, click-to-focus
- session-assignment model replaces text cards (types, serialization, transforms)
- question dialog drives NEEDS YOU (blocked) instead of sitting on RUNNING
- diagnosable smart-whisper load failures (press-to-talk Task 3)
- press-to-talk pill — record on press, insert on stop (press-to-talk Task 2)
- configurable dictation shortcut (press-to-talk Task 1)
- platform-aware shortcut labels (⌘ → Ctrl off-mac, incl. Server Edition)
- window/taskbar icon from bundled png
- electron-builder AppImage + deb target, dist:linux script
- full-page board toggle (tab bar, palette, cmd-shift-b) over the mounted canvas
- board UI components (view/column/card) + styles
- per-project view-mode store + setProjectKanban action
- pure board transforms + tests
- kanban board types ride .nodeterm/project.json
- Settings → Speech — engine, models, language (desktop-dictation Task 11)
- Insert without Enter — sendText gains an enter:false variant (desktop-dictation Task 10b)
- dictation overlay + dock mic + shortcut (desktop-dictation Task 10)
- preload + real ws-bridge speech API (desktop-dictation Task 9)
- renderer PCM capture via AudioWorklet (desktop-dictation Task 8)
- smart-whisper native dependency (desktop-dictation Task 7)
- speech IPC surface wired in main + server (desktop-dictation Task 6)
- cloud engine + pinned multipart contract (desktop-dictation Task 5)
- core speech service — pro gate, model lifecycle, FIFO (desktop-dictation Task 4)
- whisper model store with fenced downloads (desktop-dictation Task 3)
- wire mirror settings providers (local caps/accounts, per-SSH-host)
- pcm/wav codecs (desktop-dictation Task 2)
- SSH status push injects per-host settings into each slice
- shared model catalog + speech settings (desktop-dictation Task 1)
- optional settings block (permission mode, accounts) in the mirror
- show the session's model name on the header pill
- setting to keep expand/collapse choices across project switches
- lock freezes the camera only — nodes stay movable and resizable
- one drag-droppable project order shared by tab bar + sidebar
- configurable default size for new terminal/agent nodes
- registerNode derives agent color/label like createAgentNode
- jailed core bridge — typed git verbs + node registration over the relay
- mirror each SSH project's agent status onto its host
- use the real opencode logo for the agent icon
- Dockerfile for Server Edition (Dokploy/PaaS deploys)
- keepalive + auto-reconnect for dropped SSH-project terminals
- opencode menu icon
- read opencode transcripts via 'opencode export' (SQLite-safe)
- opencode AGENTS.md gets the context-link + canvas-control blocks
- managed opencode plugin (env-gated, marker-owned, fail-open)
- normalize opencode plugin events to the shared state model
- honor flag-prompt injection at launch (opencode --prompt)
- register opencode as a builtin (hooks, resume, context-link, canvas-control)
- SVG explorer/gear icons at 18px + Help → Documentation link
- ghost hint on an empty canvas (right-click / ⌘K / dock)
- Core vs Pro comparison with live remote-access meter
- one-shot idle-gated discovery note per agent session
- remote-access quota banner (silent 1st use, n/5 from 2nd, upgrade at limit)
- broaden skill/instruction triggers (parallelize, subagents, delegate)
- provision relay for free-tier phones while quota lasts (QR pairing itself stays free)
- installing/ready/failed states instead of optimistic dismiss
- free-tier standing host — quota-gated admission, n/5 notices, hard block at 6th
- re-probe tmux on demand (ensureTmux) so an install lands without restart
- expose relayQuota over preload/bridge and init it in main
- echo-verified command delivery module
- monthly relay remote-access quota for the free tier
- Settings → Team Access section (invite, seats, per-peer revoke) (team-access Task 4)
- renderer store for live/pending Team Access seats (team-access Task 3)
- multi-peer host pool + invite/revoke with a seat cap (team-access Task 2)
- seats in the entitlement (premium→N, absent→1, free→0) (team-access Task 1)
- echo your own cursor-chat back as a timed bubble
- quick-pair popover on a top-right phone button
- tmux banner bootstraps Homebrew on Macs that lack it
- the Remote Login warning opens System Settings and clears itself
- '?' opens a help menu — shortcuts, bug report, repo link, version
- Report-a-bug dialog (prefilled GitHub issue)
- bug-report URL/env helpers
- DinoNode broadcasts as authority + spectates peers, with a lowest-id tiebreak (dino Task 4)
- "tmux not found" banner with one-click install
- game engine broadcasts snapshots + renders a remote spectator view (dino Task 3)
- wire presence.dino cast + selectDino selector (preload/bridge/session) (dino Task 2)
- lock toggle in the bottom-left Controls — freeze pan/zoom/drag gestures
- PeerState.dino + sanitize + hub cast handler for live spectating (dino Task 1)
- Canvas canvas-sync publisher + onMutation follow the active session (collab Task 4)
- Canvas presence connect/report follow the active session (collab Task 3)
- route presence components + cursor/chat write to the active session (collab Task 2)
- useActiveSessionPresence — the active session's presence store (collab Task 1)
- poll connected SSH projects so mobile-started sessions reach the canvas
- make the permission-mode auto gate and account pickers legible on SSH projects
- populate the relay tab from the host's shared project (project-scope Task 4)
- host picks which project to share when hosting (project-scope Task 3)
- exclude remote (relay) projects from persistence (project-scope Task 5)
- scope the workspace:load response to the shared project (project-scope Task 2)
- thread sharedProjectId through relayHost.start → session (project-scope Task 1)
- open-terminal gains --count/--group; shared grid helper
- route worktree path + clone picker through the session core (Stage 4 Task 9)
- show ConsentNotice + relayHost source in the host approval dialog (Stage 4 Task 8)
- tidy placement for orchestration
- offline "unavailable" tab + reconnect (Stage 4 Task 7)
- enable Codex and Gemini in Add menus by default
- custom branch dropdown, matching the app's own menus
- remote session as a project tab (Stage 4 Task 6)
- buildRelayApi — bridged NodeTerminalApi for a remote-desktop tab (Stage 4 Task 5)
- orchestration recipe + --group on open-claude/open-agent
- client-side connector connectRelayClient (Stage 4 Task 3)
- wire the interactive host-accept flow (initRelayHost)
- IPC channels + preload surfaces for the new tunnel (relayHost/relayClient)
- a bridged peer is a CorePlatform client (sink + presence + dispatch)
- mutual approval driven only by the encrypted tunnel (obligation a)
- electronPlatform.dispatch/cast — a peer's RPC reaches the core's handlers
- tunnel rpc.ts frames over the E2EE socket (+ honest bufferedAmount)
- runtime session dimension on tabs (no persisted change)
- shell-access consent copy + describeGrant + minimal notice
- revoke (unpin + onRevoke kill hook) — unpinning alone is insufficient
- mutual SAS + pin-both-ends approval state (pure)
- wire the peer registry to PtyManager at boot
- electronPlatform routes sendTo/clientIds/broadcast to peer sinks
- peer sink registry with WS-close-mirrored teardown
- ensure fullscreen TUI in settings.json (write-if-absent, version-gated)
- persistent safeStorage-backed peer keypair (stable client identity)
- WorkspaceSession + context + registry, mount local session
- extract UiSinkRegistry (sinks + WS backpressure) from ServerPlatform
- pure safeStorage-agnostic keypair file codec
- open-worktree / close-worktree verbs
- serve pty.scroll so a phone can scroll tmux's history
- project monogram + distinct project/group/session levels
- Cmd/Ctrl+click opens URLs in the browser and file paths as editor nodes
- New File / New Folder via right-click (local + SSH)
- mkdir + exists across desktop, server and SSH surfaces
- expanded directories persist across drawer close and app restart
- Shift+Enter inserts a newline in agent CLIs (ESC+CR through tmux)
- worktrees are explicitly unsupported in SSH projects (v1)
- live branch/dirty/ahead-behind on the group chip; bound frames look bound
- Source Control operates on the selected checkout
- one-step creation with the repo pre-filled and existing worktrees listed
- renderer store owns repo root, worktree list, throttled status
- pure reconciliation of bindings against git worktree list
- publish local node mutations to peers and apply theirs (loop-guarded)
- window.nodeTerminal.canvas (mutate + onMutation) on preload and ws-bridge
- mutation publisher (diff, 20Hz drag throttle, adopt loop guard, ephemeral filter)
- canvas:mut reflector fans node mutations to every client but the sender
- CorePlatform.clientIds() exposes the attached-client registry
- pulse a peer's chip while their keystrokes land in this terminal
- render the pty's authoritative size, letterbox the rest, handle redraw + peer delete
- expose pty:size, pty:closed and pty:resync to the renderer (desktop + browser)
- destroying a co-viewed node closes it for the other viewers
- attribute pty:write to the sending client (typing badge)
- say so when the local CLI is too old for the Auto permission mode
- smallest subscriber wins — authoritative pty:size broadcast
- probe the local claude CLI's capabilities
- pure version gate for `--permission-mode auto`
- one pty, N subscribers — idempotent pty:create + subscriber fan-out
- smallest-subscriber size math + pty:size / pty:closed channels
- mount presence layer, facepile and name prompt
- per-node presence chips + focus reporting
- presence facepile + first-connect name prompt
- pure facepile logic (label, dimming, click target)
- PresenceLayer — live cursors, name labels, cursor chat
- transient presence store (peers, identity, focus)
- window.nodeTerminal.presence (preload + ws bridge)
- per-project default permission mode in the tab menu
- interactive relay host joins its bridged phone as a peer
- permission mode control in Settings → Agents
- desktop window + relay phone peers join the presence hub
- launch claude nodes in the resolved permission mode (new, resume, branch)
- join/leave the presence hub per WebSocket
- serve pty.captureHistory so a re-attaching client can hydrate scrollback
- claudePermissionMode global + per-project override, persisted to project.json
- PresenceHub — peer table, project scope, diffs, typing throttle
- pure permission-mode core (flags, resolver)
- presence wire contract (PeerState, PeerDiff, palette)
- CorePlatform.onWithSender — casts carry the sender id
- hydrate xterm scrollback from tmux history on warm reattach
- xterm owns selection + scrollback (scrollback cap, Alt-select, Ctrl+Shift+C)
- pty.captureHistory on desktop + server bridge
- captureHistory — tmux scrollback above the visible screen, capped
- mouse off — selection belongs to the terminal emulator, not tmux copy-mode
- standing host keeps a warm listener pool (concurrent clients, no churn)
- real onAgentStatus / onSubagentActivity subscriptions over the WS client
- start hook server + install managed hooks + agent-status mirror at boot
- agent-status wiring — hook listeners + tails route over platform.broadcast
- mirror SSH project files to the server + reconcile on connect
- unavailable tabs, external-change reload + conflict bar, migration note
- adopt existing .nodeterm project on open-folder
- watch project files for outside edits
- v3 index + per-project .nodeterm files with v2 migration
- show reconnect overlay on initial-connect failure (no blank screen)
- pure split/join module for per-project files
- WS backpressure — pause the tmux client when the socket buffer fills
- preload + bridge surface for probe/migrated/external-change
- shared types + IPC channels for per-project storage
- shell.openExternal opens a browser tab; document reveal/openPath no-ops
- web folder/file picker (server-directory browser) for dialog.select*
- real fs/git/files/context namespaces over the WS client
- git + commit handlers, wired into boot (registerCoreHandlers)
- fs.* + files.quickOpen handlers over core fs-ops
- extend canvas control to codex/gemini
- projects.list host RPC for relay-based project browsing
- WS window.nodeTerminal bridge + bootstrap split (desktop pass-through)
- end-to-end encrypt LAN pairing to the QR host key
- graceful stub surface for the browser build (boot-path audit encoded)
- config + boot — startServer() wires auth/http/ws/CorePlatform/PtyManager
- authenticated /ws endpoint routing RPC frames to ServerPlatform
- http layer — static renderer serving, CSP rewrite, auth routes, login/setup pages
- single-user auth — scrypt password, sessions, setup token, rate limit
- ServerPlatform — CorePlatform over a WS sink registry + RPC dispatch
- WS-RPC protocol types + binary pty-frame codec
- project-level high score — new dino nodes start from the record
- P3 desktop host — standing phone relay host + pin-once approval
- canvas sends agent identity + per-agent link notes
- contextLink.info IPC exposes the CLI shim path
- install get-linked-context instructions for codex + gemini
- CLI parses codex rollout + gemini chat transcripts
- per-agent transcript resolution via handoff locators
- link map carries agent identity; per-agent link messages
- codex + gemini join CONTEXT_LINK_CAPABLE
- tidy the right-click menu — grouped sections, no New chat
- terminal chat icon toggles the Cmd+M view instead of forking
- branch verb — agents can branch a Claude node's conversation
- richer skill triggering — creation/grouping/team phrases
- open-agent verb — open codex/gemini/custom agent sessions
- mirror live agent status to agent-status.json
- per-device pairing registry + revoke (Phone)
- Claude icon + default ✓ in account pickers
- rename verb — agents can retitle any node (groups too)
- Pair phone — in-app QR pairing for nodeterm mobile
- install.sh downloads via nodeterm.dev proxy (works while repo is private)
- renamable, email-labelled System account entry
- replace the 'Settings' title with a 'Back to app' button
- curl-able install.sh for the landing page
- project actions on right-click of a project header
- scrollable tab strip + instant terminal preview on switch
- persist cron/schedule cards and control ropes
- counter-scale group label pills when zoomed out
- host-scoped remote SSH accounts
- account chip on node headers + ChatPanel account threading
- renderer handles group/arrange/align/spawn-team
- group/arrange/align/spawn-team verbs + skill docs
- pure arrangeNodes + alignNodes layout helpers
- per-account usage (scoped keychain service)
- chat node runs on the node's managed account
- account-aware transcript resolution
- account pickers in menus, palette, dock + project default
- Settings accounts section + canvas login-node flow
- account-aware node factories, persistence + branch/fork inheritance
- install managed hook into each account config dir at launch
- inject CLAUDE_CONFIG_DIR + strip auth env at PTY spawn
- main-process account service + IPC + preload API
- shared types + pure core for managed Claude accounts
- allow zooming the remote session canvas out to 1%
- typing indicator for the pre-stream gap
- terminal→chat fork action + fatal-error reconnect
- slash popup, image attachments, diff-preview cards
- chat node factory + canvas/dock/palette integration
- ChatNode UI — streaming bubbles, permission card, queue, stop
- renderer chat state — pure reducer core + transient store
- main-process ChatDriver + chat:* IPC wiring
- push-iterable + input queue primitives
- pure SDK-message → ChatEvent reducer
- shared contract — ChatEvent types, chat:* IPC, preload API
- add claude-agent-sdk + electron-main spike
- status glow + pulse — amber working, red needs-you, blue unread
- red pulsing glow behind terminal nodes waiting on the user
- needs-you and unread counts on project group headers
- surface macOS permission denial + Open System Settings repair path
- unread shows as a pulsing accent-blue check in the status slot
- needs-attention rings a bell — red filled bell replaces the attention dot
- soft pulsing amber glow behind terminal nodes while the agent works
- visible unread bullet next to the session title
- REF-parity status glyphs — done gets a check icon, attention goes red
- open the clone dialog from the start screen and command palette
- CloneRepoDialog with shorthand preview, progress bar and abort
- sticky note entries in link files, CLI, and skill
- streaming spawn-based clone with progress, abort and claimed-dir cleanup
- sticky↔terminal note links — gate, one-shot push, edge style, link map
- link handles on sticky notes
- shared pure helpers (shorthand, validation, progress parse)
- pure helpers + note field for sticky context links
- default-disable codex/gemini for new users
- Chrome-like start page for a blank browser node
- show start page in a blank node + record history + smart address bar
- BrowserStartPage (search + shortcuts + recent) + styles
- shortcut list + SiteIcon (inline SVG marks + monogram)
- show a PRO badge on server rows while unlicensed
- bind entitlement to the device and guard against clock rollback
- show a PRO badge on server rows while unlicensed
- bind entitlement to the device and guard against clock rollback
- browserHistory store (localStorage, addEntry)
- searchOrUrl (URL or Google search) helper
- opt-in plain-wheel zoom ("Scroll wheel zooms")
- gate SSH remote project connections behind Pro
- add "New browser" to the pane right-click menu
- new-window requests spawn another connected browser node
- open-browser agent control verb
- Open browser… command
- BrowserNode component with nav toolbar + last-URL persistence
- normalizeAddress url helper
- browser node kind + factory + serializer
- manually rename a canvas group from the sidebar
- open agent nodes below source + visible connecting rope
- renderer applies agent canvas commands with confirm-gated destructive ops
- install nodeterm CLI shim + manage-nodeterm-canvas skill
- main<->renderer round-trip with pending-request map + 120s timeout
- /control/* JSON routes + setControlHandler on hook server
- pure canvas-control core — verb model + CLI script
- CANVAS_CONTROL_CAPABLE + NODETERM_CANVAS_CONTROL env (claude-only)
- WebNode (webview) for URLs + local html; enable webviewTag
- VideoNode + route video files from explorer/openFile
- nt-media:// streaming protocol with range + path jail
- video/web node kinds — factories + serializers
- show agent/kind icon and section for node-jump entries
- search Claude transcripts, focus-or-resume on click
- service, search IPC, preload bridge
- two-way sync between node title and session name
- incremental refresh planner
- pure extract/search core
- add Pull/Push/Sync to the Source Control '…' menu
- auto-fetch while the panel is open (accurate ahead/behind, local + remote)
- gitAutoFetch setting (default on) + Settings toggle
- thread remote tmux confPath + OSC 52 clipboard handler (remote scroll + copy)
- write+source remote tmux.conf on connect, thread tmuxConfPath to -f
- remoteTmuxConf (mouse/clipboard via OSC 52) + remoteTmuxCommand -f confPath
- non-destructive Close project + Recently closed reopen
- drop a file on a remote terminal uploads it + pastes the remote path
- uploadFile — scp a dropped file to the remote over the master
- Source Control + Diff nodes operate on the remote repo for SSH projects
- route git() + commit-message over the master for SSH projects
- remote-git builder + runner + resolver registry + refForRemoteCwd
- create a new remote folder from the SSH project browser
- Explorer + Editor route to sshFs for SSH projects
- sshFs IPC + preload + renderer FsApi + refForProject
- ssh-fs ops over the master (list/read/readBinary/write, fail-open)
- route remote nodes to remote transcript tails/search (jailed)
- remote context-tail + subagent-tail (async poll) + sshRemoteForNode
- extract pure transcript parsers + remote-file reader
- inject remote hook env on remote tmux + thread hookEndpointPath
- remote-hooks — reverse tunnel + remote endpoint + remote hook install
- pure hook-forward/env builders + unix-socket script branch + pure merge + getters
- Connect-over-SSH creation flow + remote dir browse + status
- projects store + factory remote stamping
- pty-manager remote-tmux spawn mode (remote fresh/kill/capture)
- ControlMaster manager + listDir + status IPC
- pure control-master + remote-tmux builders + shared types
- cold-restore terminals after a machine reboot
- give the New dino game action its own dino icon
- '+' opens the start screen (WelcomeScreen) instead of a dropdown
- recolor sprite per-pixel to restore the eye, mouth, and arm
- add an eye to the T-Rex
- draw authentic Chrome sprite art for dino, cacti, and birds
- replace vendored engine with self-contained pixel-art game
- reorder sessions in the sidebar by drag-drop
- wire dino node into canvas menus, dock, and CSP
- game wrapper, DinoNode component, and styles
- vendor T-Rex Runner engine, sprites, and sounds
- AI-name canvas groups from their members' output
- add dino node kind, factory, and highScore serialization
- show canvas groups in sidebar + drag a session in/out of a group
- Remote access from the project caret menu + upgrade popup for non-Pro
- import saved servers from ~/.ssh/config (Settings button)
- default-pinned sidebar + per-row AI name action
- blue glow on a node when its agent finishes while unfocused
- collapse non-active project groups by default
- Settings — saved SSH servers CRUD
- ask-first remove worktree with process-before-git teardown
- merge-to-main group action
- wire SessionsSidebar into Canvas (button, focus, close, rename, add)
- opt-in move existing terminal into worktree (guarded respawn)
- SessionsSidebar shell with groups, search, pin, branch, add
- new terminals inherit group worktree cwd + header chip + unbind
- IconSessions/IconPin + SessionRow component + styles
- bind dialog + group bind action
- projects store node rename/recolor/remove/duplicate actions
- reveal a file result in the Explorer panel
- Files section with fuzzy file search + open (editor/OS)
- main-process quick-open file lister + files.quickOpen IPC
- pure fuzzy ranker for quick-open file search
- pure quick-open file-listing filter (rg/git args + blocklist)
- pure session-list grouping helper + tests
- executor-injected worktree ops + GitService wiring
- pure helpers for path, porcelain, safety, merge strategy
- GroupWorktree type + serializer round-trip
- New remote entry points (pane menu, palette, dock) + picker
- overflow menu — fetch/force-push/merge/rebase/rename/delete/stash
- commit context menu — revert / new branch / checkout
- backend git actions — merge/rebase/branch/fetch/stash/revert + IPC
- reusable Pro upgrade dialog + gate helper
- TerminalNode launches ssh + header badge
- renderer ssh-servers store, node factory, persistence
- pty-manager runs a resolved program + shellArgs (ssh)
- main ssh-store + ipc + preload bridge
- pure ssh arg builder + shared types
- wire full-page SettingsPage and remove old drawer
- add SettingsSidebar (categories + search box)
- add Sessions/Account/Application sections
- add Agents sections (agents, custom, notifications, commit)
- add General sections (terminal, shell, behavior, appearance)
- add section shell, searchable row, and field row
- add search matcher and navigation data
- add ui/ primitives and relocate SegmentedPill
- Cmd+M opens chat panel on chat-capable agent nodes
- ChatPanel component + styles
- structured transcript reader + chat:read-transcript IPC
- inject idle-gated discovery note on connect
- cut over from MCP bridge to pull-based context links
- electron wiring module (dormant)
- pure core, CLI source, and tests (dormant)
- context:ensure IPC to track a session's transcript on demand
- New Remote Connection UX + end-to-end remote project mirror
- remote filesystem (explorer + editor over relay)
- terminal snapshot + attach-to-existing (live remote session)
- client remote-session mirror view + mutations
- host broadcasts active-project canvas + applies client mutations
- canvas-sync wire-format (applyMutation/diffToMutations)
- NT_MULTI flag to run a second instance (host+client testing)
- host-only Pro gate — connecting to a host is free
- persist commit-message draft + AI generation across panel close
- transfer conversation node action + context menu
- wire handoff:build IPC handler
- locators + buildHandoff orchestrator
- full Gemini transcript renderer
- full Codex transcript renderer
- full Claude transcript renderer + format helpers
- shared capability, IPC channel, and API types for transfer
- publish reuses the existing git token — no separate gh login
- VS Code-style in-app Publish to GitHub picker
- client RemoteTransport + remote-access UI (isPremium-gated)
- host service serves PTYs over the relay
- relay socket + E2EE handshake + RPC/frame state machine
- port NaCl e2ee + terminal framing + pairing codec
- chain gh login into repo creation in Publish to GitHub
- adaptive remote action — Publish Branch / Push / Pull / Sync
- copy mouse selections to clipboard like a native terminal
- device-bound Upgrade flow (no key paste)
- surface git action errors as a banner atop the panel
- wire commits graph into Source Control + canvas
- entitlement store + Settings License section
- wire find-bar into terminal node (button, Cmd+F, xterm highlight)
- useTerminalSearch hook (snapshot index over scrollback + transcript)
- IconSearch + FindBar presentational component and styles
- main-process Claude transcript reader + claude.readTranscript IPC
- main-process license module + offline entitlement verify
- DiffNode commit mode + factory/serializer plumbing
- client IPC/types/preload contract
- commits panel (lazy file expand + cache)
- commit file list + context-menu builder
- commit row with graph + ref badges
- swimlane graph SVG + timestamp format
- graph color tokens + panel styles
- preload git-history APIs + shell.openExternal
- main-process history/commitFiles/remoteCommitUrl + IPC
- shared graph view-models + ref dedupe (ported)
- hide disabled agents from Add menus; ⌘⇧C launches default agent
- shared history loader (ported)
- REF-style Agents pane (enable/disable + default)
- shared types + log parser (ported from REF)
- reusable SegmentedPill control
- disabledAgents + defaultAgent settings with availability helpers
- brand logos in Add menus via AgentIcon
- Update Card 'required' mode for mandatory updates
- client check.ts feed (messages + update policy) replacing announcements.json
- codex hooks via ported config.toml trust (writes ~/.codex)
- user-defined custom agents in Settings
- real codex + gemini event normalization
- gate Claude-only UI on capabilities; registry-generated agent menus
- createAgentNode factory + data.agentId + legacy tag migration
- wire HTTP hook server into main + pty spawn, rename IPC to agent:*
- per-agent hook services + installer registry
- loopback HTTP hook server with endpoint-file restart handoff
- normalized event types + claude normalizer
- agent config registry + capability lists
- model-window resolver (Models API + static fallback)
- drop first-run privacy banner; keep Settings toggle only
- privacy banner + Settings usage-data toggle
- main-process ping module + device id
- add telemetryEnabled/telemetryNoticeSeen settings
- per-node context-window meter pill and popover
- renderer store and Canvas wiring for context updates
- expose context API on window.nodeTerminal
- main-process transcript tailer for context-window fill
- shared types and IPC channel for context-window meter
- bottom-left Claude usage pill and popover
- renderer formatting helpers (time-ago, reset, bar color)
- expose usage API on window.nodeTerminal
- main-process Claude usage fetcher and polling
- Settings section with version + manual check
- shared types and IPC channels for Claude usage indicator
- bottom-right UpdateCard with progress, minimize, restart
- forward progress/error/check events + ready notification
- add progress/error/check IPC contract for update card
- add Session Bridge plus PTY perf and robustness fixes
- make subagent/loop nodes first-class (select, drag, resize)
- subagent node opens a terminal-like live view (reliable toggle)
- loop/cron node shows full task + Play (manual trigger)
- detect /cron too; derive the node label from kind
- detect /schedule like /loop (Schedule node)
- make subagent + loop nodes draggable
- /loop gets its own connected node (iterations + content)
- live subagent transcript (click to expand, streams while working)
- lay out subagent nodes in a 4-wide grid (wrap rows)
- subagent node expands while working too (task + status/result)
- subagent token/duration details + click-to-expand result
- visualize subagents as connected nodes + /loop badge
- label the unread indicator (blue dot + 'unread')
- unread count badge on project tabs + clearer terminal unread dot
- REF-style notification content (title + last message)
- REF-style global env-gated hooks + 4 states + cooldown + persist
- polished notification-consent dialog (REF-style)
- ask notification permission on first launch + Settings control
- /branch node action + document Claude Code support
- session-name chip + Cmd+K content search
- busy indicator, unread badge, completion notification
- foundation — status store, sendText, notify/focus IPC
- dashed frame + floating label pill, fix radius mismatch
- generate social media images (og/avatar/banner)
- image preview for image files instead of binary text
- redesign app icon as a black terminal window with our mark
- use the flat nodeterm mark for the logo
- redesign landing page (REF-inspired)
- add nodeterm.dev landing page + README hero illustration
- self-hosted update feed, signed-release CI, and in-app announcements
- add support for file selection and git diff viewing

### Changed

- Revert "Revert the pane double-click overview zoom, keep the empty-canvas fly-back"
- Revert the pane double-click overview zoom, keep the empty-canvas fly-back
- name the two actions Refresh and Restart
- caffeinate the mac upload step too
- drop npm cache on the self-hosted mac runner
- publish job writes commit-derived release notes before promoting
- security pipeline — CodeQL, dependency review, Dependabot
- cask sync moved into the tap's own workflow (org disables deploy keys)
- Homebrew cask lives in the official org tap (nodeterm/homebrew-tap)
- publish job updates the Homebrew cask (eneskirca/homebrew-tap)
- platform jobs create a prerelease; a publish job promotes to latest only when both succeed
- click opens the card, Trello-style drop highlight, bigger type, motion pass
- caffeinate the mac build; idempotent asset upload with retries
- move the usage service into core so Server Edition serves it (#7)
- move isMac below the import block (Task 1 review nit)
- release-linux job (AppImage + deb to the same GitHub Release)
- drop the auto-injected per-session discovery note
- keep the mailto recipient raw — encodeURIComponent over-encodes @ and a valid email is safe
- encode the mailto recipient too (Task 4 review Minor)
- You've hit your weekly limit · resets Jul 17 at 8pm (Europe/Istanbul)
- You've hit your weekly limit · resets Jul 17 at 8pm (Europe/Istanbul)
- redraw the lock toggle as a filled padlock with keyhole
- drop the upload-artifact step (it filled the Actions storage quota)
- rate-limit malformed dino casts; exempt only the genuine null stop (dino Task 1 review)
- delete remoteClient dialect + migrate settings dialogs (Stage 4 Task 10)
- delete RemoteTransport (Stage 4 Task 10)
- remove data.remote + createRemoteTerminalNode (Stage 4 Task 10)
- delete RemoteSessionView + its overlay CSS (Stage 4 Task 10)
- route ConsentNotice label through the view-model; style the grant callout
- extract FrameTransport seam under RpcClient
- Canvas agent event streams via session (chunk E)
- Canvas chat via session (chunk D)
- Canvas pty/canvas via session (chunk C)
- Canvas git via session (chunk B)
- Canvas workspace/fs via useSession().api (chunk A)
- ChatNode reads api.chat from the session
- editor/diff/explorer + source-control read fs/git from the session
- terminal/chat leaf consumers read pty/chat/fs from the session
- LocalTransport takes an injected api
- per-session factory; local session reuses default instance
- PresenceLayer casts via useSession().api.presence
- per-session factory; local session reuses default instance
- ServerPlatform delegates to UiSinkRegistry (behavior-preserving)
- give scrolling, selection and the clipboard back to tmux
- drop two fields nothing reads
- electron.vite.config.ts
- one shared canvas mutation vocabulary (apply + diff)
- drop the dead createClaudeNode wrapper, ⌘⇧G toggles Source Control
- activePermissionMode reuses getProject; add store-wiring tests
- move commit-message into src/core (electron-free leaf)
- run on self-hosted Apple Silicon runner (no billed macOS minutes)
- finish phase-1 extraction — docs + reverse-import guard
- move license + context-link onto CorePlatform
- move git-service onto CorePlatform
- move remote-git (pure ssh leaf) into src/core/remote-ssh
- move workspace/settings stores onto CorePlatform
- move PtyManager onto CorePlatform
- move control-master (pure ssh leaf) into src/core/remote-ssh
- move model-window into src/core (fix core→main edge from context-tail)
- context/subagent tails take a send callback, move into src/core
- claudeConfigDirFor into core; move chat-driver
- move agent hook server + installers into src/core
- move app-path stores onto CorePlatform (scrollback, device-id, check, transcript-index, agent-status-mirror)
- move pure leaf services into src/core
- electron CorePlatform adapter, initialized at boot
- CorePlatform seam + electron-import boundary test
- retry build/sign/notarize up to 3x for transient notarization errors
- notarize via App Store Connect API key + --publish never
- RUNNING/working state color amber → clay #d97757
- security+perf: app hardening pass for release
- collapse redundant branch-picker filter ternary
- add Tailwind v4 (no preflight) bridged to :root tokens
- refine commit composer — inline ✦ corner action, cleaner primary
- remove orphaned .sc-log CSS after error banner relocation
- drop dead recent-commits query + unused CSS/prop after graph panel
- Canvas consumes NormalizedAgentEvent
- rename claudeStatus store to agentStatus (+agentId, ls migrate)
- drop dead hidden-label span and unreachable fetching branch
- Add editor nodes, AI naming, markdown view, explorer, and undo/redo
- Add projects, tmux session continuity, settings, and source control
- Initial commit: node-terminal MVP scaffold

### Fixed

- opening a session marks its finishes read, whatever it is doing now
- one machine, one hook script — a second instance can't silently kill them
- card-modal terminal is clamped to the hidden canvas node's grid
- refocus the app window after a file is dropped in
- co-attach terminal can't scroll until a keystroke
- nodes an agent opens in an SSH project run on the HOST
- `/rename` no longer splices into a launch command; one edge per pair
- a missing managed script must not block every prompt
- correct visibility-toggle copy and sub-heading style
- Esc that ran no Stop hook no longer leaves a node working
- Esc reaches the modal terminal (agent interrupt) instead of closing the popup
- relaunch through withPermissionMode, from one shared agent-id
- never quit a CLI whose pane we cannot watch
- a transport that throws ends the delivery instead of stranding it
- the transferred-to agent orients itself and asks, instead of resuming on its own
- a rejected restart is a counted failure, not a lost bulk run
- reading a session clears it everywhere, even unwatched
- one central rule for a working session that went quiet
- spawn Duplicate/Branch/Transfer nodes where the user clicked
- hold the node until the resume line has left the pane
- stop showing a working session nobody has heard from
- don't resurrect old finished sessions at every launch
- transfer works on SSH projects; report-only dialogs stop offering "Delete"
- bound the pane query by the deadline; guard the synchronous-echo delivery path
- wrap long unbroken tokens instead of scrolling the message sideways
- reading is per row — opening the panel marks nothing read
- a blocked session is busy — /exit would answer its permission prompt
- + New menu opens downward; card modal clears unread + is the dictation target
- cross-project "go to node" no longer lands on the canvas origin
- centre the mascots; the green blob clears AFTER you read it
- symmetric notch extension + smaller done blob
- hover opens the panel; smaller mascots; capsule sits flush
- widen the notch sideways, mascots bottom-left — no extra height
- let the window paint OVER the notch, not below the menu bar
- append codex hooks to preserve trust
- keep the confirm dialog within the viewport for long messages
- keep the app in the Dock; match agent-notch's look
- mascots sit BESIDE the notch, not on top of it
- accept a first-seen host key instead of aborting the connection
- codex installs over SSH — the one agent the remote path skipped
- restarts neither re-push done events nor kill tmux sessions
- explicit context loss on release, desktop cap raise + reload action
- make the resume instruction conditional on a task existing
- context-budget the transfer file so the target agent survives reading it
- same-lineage reconcile unions nodes — a phone session survives
- sessions born on a bare host self-heal once a server appears
- frame injected prompts as bracketed paste so a multiplexer can't swallow the Enter
- context links work for agents launched by hand in plain terminals
- fit view into the largest chrome-free rectangle
- download Node beside the destination, never /tmp
- provision a private Node when the host's is missing or old
- rebuild an adopted orphan master whose hook tunnel is dead
- Approve/Deny header buttons hide while a question is asked
- multiSelect rides the question pipeline; state edges are marked
- hermetic opencode plugin test + swallowed post-shutdown usage polls
- instant state flip on answer + approval cards say WHAT needs approving
- AskUserQuestion pickers are questions, not approvals
- consistent Back+Next footer on the notifications step
- branch menus scroll instead of running past the viewport
- platform-aware ⌘⇧C label + SVG check (Linux glyph tofu)
- color the actor in board-log activity + comment rows (Trello-style)
- self-healing mux children + master watchdog — stop the silent per-exec reconnect churn
- long card titles wrap (2-line clamp) instead of widening the column
- mount the indicator outside <ReactFlow> so the open popover rises above the sessions sidebar (#20)
- usage poll must not gate on connected browsers
- a superseded overlay instance delivers its transcript but never closes the successor (review)
- clamp comment text (SSH arg-max silent loss, unbounded file growth)
- IME-safe composer, scoped error note, stable empty-list selector
- modal seed paint uses xterm text transforms; guard the cold-path await
- keep a client's per-connection socket pause when one view leaves
- Esc during a modal rename cancels the edit, not the modal
- recover the WebGL renderer after sleep/wake context loss
- remount the dictation overlay on retarget — in-flight take can't cross nodes (review)
- remote send-keys joins with && — no Enter unless the text landed (review)
- guard inline (cwd-less) projects against v1/malformed board shapes
- sendText reaches SSH-project nodes via remote tmux send-keys (dictation)
- a dismissed pill drops the in-flight transcript — nothing lands after cancel (Task 2 review)
- wrap Dictate hint with hintLabel; drop dead blockmap glob
- degrade auto-update to a manual-download link on Linux .deb/.rpm
- drop malformed kanban from hand-edited files; banners paint above the board
- dedupe user message.updated — post-idle touch pinned nodes on RUNNING
- last-column delete is a no-op, not a dead confirm dialog
- dead hook exports + missing unix-socket transport killed all statuses
- keychain version warning is macOS-only
- reject unknown model ids in delete() — no path traversal via the authed surface (final review)
- route Pro errors to License, actionable consent message (final review)
- cap takes at 2:30 — an oversized ws frame would drop the whole bridge (final review)
- mac mic usage description + hardened-runtime audio-input entitlement (final review)
- externalize smart-whisper in the server bundle — inlined loader can't find its native binding (final review)
- a failed has-session probe is not a cold start
- notification click into a closed project reopens its tab first
- adopt the mic stream before context construction — a failed start() must stop its tracks (Task 8 review)
- airtight start() re-entry guard + worklet port teardown (Task 8 review)
- reference IPC constants in the speech registrar, not literals (Task 6 review)
- @ts-ignore the optional smart-whisper import — expect-error would break the build once the dep lands (Task 4 review)
- sweep orphaned part files, un-dead delete()'s part cleanup (Task 3 review)
- delete() must not yank a newer download's part file (Task 3 review)
- copy base64 pcm out of the Buffer pool — alignment is not an API guarantee (Task 2 review)
- verify the reverse hook tunnel end-to-end; start hookServer first
- jail the phone bridge to every local project root, not the focused tab
- version probe finds a ~/.local/bin claude — auto mode was silently manual
- follow a link across hard-wrapped rows (tmux repaint / TUI)
- keep the camera on in-place project reloads
- restore the reconnect pieces missing from 576d606
- handle the ws 'error' event so a relay 504/outage can't crash the app
- reclaim the dead scrollbar reserve on the terminal's right edge
- honor XDG_CONFIG_HOME for opencode's config dir
- charge relay quota on approval, not bridge; hourly reconcile for month rollover
- stop polling when dismissed mid-install
- never submit a mangled launch command (quote> strand)
- reserve seats at mint with a revocable id — closes the cap race + pending-seat leak (team-access Task 2 review)
- move the facepile beside the top-right toolbar, not under the chrome
- use the gated presence.dino wrapper + emit the yield-null (whole-branch review)
- resolve the window at event time (crashed with "Object has been destroyed")
- per-project remote endpoint file so a folder-picker browse can't kill hook delivery
- tolerate gits without --end-of-options — old remote hosts showed empty history
- route commit history through the ssh-aware executor — it never worked on SSH projects
- Cmd/Ctrl+click links inside tmux mouse-reporting mode
- resolve the 'closed by' name against the active session's peers (collab review)
- session-scope terminal park/co-state keys + dispose relay session on load failure (project-scope Task 4 review)
- stop SSH projects resetting .nodeterm/project.json
- restore the phone canvas feed severed by the client-dialect deletion
- type initialCommand only after the fresh shell settles
- tame zoomed-out worktree label pills (the "vortex")
- dispose offline session by binding; reconnect disposes stale only after rebind
- repair two untested client IPC boundary bugs (confirm payload, disconnect send/handle)
- open a new worktree group big enough to hold a terminal
- dispose relay tab on project close/delete; silence declined-SAS alert
- a superseding registration reclaims the predecessor's grant
- the Base sentinel was a literal NUL byte — use a plain ASCII one
- Base is a real branch <select>, not a filtering datalist
- budget coordinator so we never overshoot the browser context cap
- no premature branch-name error, and Base is a branch dropdown
- correct readTranscript comment — stays local, not a stub reject
- freeze the E2EE handshake once ready + bind approval to the session's peer key
- keep background projects' links alive; defuse the connect note
- a locked keyring never rotates the host identity (adopt key-file-codec)
- the visibility observer never fires into a disposed effect
- clear execUnmigrated when a deferred ref becomes readable
- an untrusted ssh extraArgs contributes no tokens at all
- the peer-approval dialog can no longer be confirmed by a stray Enter
- a peer editing our node no longer erases our own exec values
- migrate existing shell / ssh.extraArgs into the machine-local index
- canvas-sync peers can no longer launder exec fields into the trusted store
- a keystroke aimed elsewhere can no longer answer a confirm dialog
- the undefined marker moves out of band, where argument data cannot forge it
- a stray Enter can no longer delete a worktree an agent asked to remove
- a cloned project.json can no longer run code (shell / ssh.extraArgs)
- serve workspace.probeFolder/onMigrated for real; getPolicy stops throwing
- mark undefined arg slots on the wire instead of guessing null → undefined
- authorize plain-terminal claude sessions (login node)
- isolate each sink send so one dead relay peer can't break the fan-out
- key the one-store-per-core guarantee on api identity, fail open on a missing api
- never destroy a pinned peer identity on a transient keyring outage
- a settings.json that exists but does not parse is never replaced
- brand placeholder store types, make createSession idempotent per id
- reject malformed key files instead of accepting garbage keys
- double-click no longer opens two editor nodes; opened files surface on top
- unset the override/feature arrays a long-lived server accumulated
- ✦ AI-name spawns locally; widen the remote transcript jail to account dirs
- a displaced chat node comes back in the fallback cwd, not the dead one
- a displaced editor/diff node shows a notice, not a dead read
- displacedByWorktree sweeps editor/diff nodes too
- a fresh dialog's default branch can't be submitted
- the confirm dialog's safety disclosures stand apart again
- the removal reports what happened to the branch, truthfully
- a closed socket rejects its in-flight requests instead of hanging them
- a trailing `undefined` argument survives the wire as `undefined`
- explorer subtree refresh, tilde-rooted SSH file links, link-provider comment, cwd-less New file gating
- a remote repo's worktrees are refused, never guessed at locally
- the worktree ops refuse a remote repo instead of stat'ing the wrong machine
- every path that drops a bound group goes through unbind
- a disabled command's reason is a note, not a searchable hint
- the SSH gate guards the field an SSH-project terminal actually carries
- a failed `git worktree list` is not an empty one — in the store too
- blank indn so the emulator actually accumulates a scrollback
- the reattach seed no longer duplicates the screen on a narrower client
- a stale Unbind takes the dead cwd off the children with it
- a git read that FAILED is never proof the worktree is gone
- a merge never chases a conflict in a base checkout that is gone
- a strike streak dies with its binding, and never with a cross-repo one
- no session dies into a dead path — not on ↪, not on Remove
- the merge confirm only promises a push it can actually make — and never ticks it
- a deleted worktree is stale on every git, and a refresh never un-stales it
- a stale group can never kill a session into its dead path
- a merge only pushes to origin when the user was told it would
- honest removal, merge confirm, recoverable stale bindings, no alert()
- every panel action opens in the ACTIVE scope, not the main checkout
- history survives the WS-RPC round trip (undefined -> null)
- unbind and remove re-reconcile the store too
- refresh the store after a mutation; dialog reflects its entry point
- serve the real data dir over app:user-data-dir (browser had none)
- pure, tested mapping to GroupWorktree (createdByApp, baseRef, safe default path)
- a deferred resync repaint never touches a dead terminal
- a superseded seed still wires input, and the resync repaint waits for the parser
- a newer refresh always supersedes an in-flight one
- guard the store against stale writes, IPC failures and dead worktrees
- the first presence hello is not a reconnect, and an oversized node is validated once
- a late ack repairs the node, and a refused cast is never made
- canvas sync converges on a real (async) bus
- socket backpressure owes its own pause ticket (never cancels the renderer's)
- release a WS pause on the drain sweep, not only on the next chunk
- bound + validate + rate-limit the session-ending casts
- only a SUBSCRIBER may steer a shared session
- paint a co-attaching client's terminal from the current screen
- co-attach review fixes (park-safe fit, no lost worktree move, respawn tombstone)
- tell deletion and recycling apart (a worktree move no longer bricks co-viewers)
- pin the sender-aware pty channels against a composed double-fire
- resync a desynced client on DRAIN, never with an empty capture
- swallow probe rejections; drop the cached auto-mode answer on disconnect
- cap a slow client's ws backlog — drop and redraw from tmux instead of buffering forever
- bound the CLI-caps wait so a hung RPC can never block an agent relaunch
- delimit the remote claude version probe, and take it off the connect path
- flow control is owed PER CLIENT — a drowning viewer can no longer be resumed behind its back
- the auto permission mode floor is claude 2.1.71, not 2.1.90 (measured)
- a co-attaching client can never inherit a paused pty, a dead one is dropped, and create() cannot double-spawn
- never launch claude with an `--permission-mode auto` it would reject
- the rate limiter may only drop self-correcting signals
- stale cursor on project switch, per-node selector churn, name spoofing
- cap the focus/project ids and rate-limit every client cast
- bound untrusted input before spreading it, cap the WS frame size
- shallow-stable facepile selectors, reachable tooltip, honest actionability
- clear cursor chat on exit, anchor the input, zoom-invariant cursors
- relay nodes hydrate scrollback via the transport; copy chord never SIGINTs
- never surface my own peer; make the single-subscriber invariant structural
- Source Control uses the branch icon, gains ⌘⇧G, consistent casing
- bound the captureHistory reply so a phone can keep it in one WS message
- WS heartbeat reaps dead sockets (no more ghost presence peers)
- resolve session names via the remote reader for ssh nodes
- stop redundant broadcasts on the presence hot path
- validate permission mode at the shell-interpolation site
- harden the presence wire contract before anything imports it
- clipboard fallback never leaks its scratch textarea or steals focus
- clipboard works over plain http (execCommand fallback), fails loudly
- cast isolates throwing listeners; one listener registry (Electron order)
- park-then-adopt no longer kills the live session; kill once
- a park during hydration no longer kills the session; no duplicated line at the seam
- tmux stays on the normal screen; no gap/staircase/dropped output on reattach
- copy shortcut preventDefault, non-Latin layouts, live scrollback
- clamp history lines at the injection sink; de-vacuous the capture tests
- trimToBytes never splits a character; clamp untrusted captureHistory lines
- server e2e tests no longer install hooks into the real ~/.claude
- ssh project file always lands on the server (retry owed mirror writes)
- skip app boot when the initial WS connect fails; reconnect string back to English
- untrack agent tails on node close (ptyDestroy) + clear backpressure paused map on detach
- platform.on supports multiple listeners per channel (matches ipcMain.on)
- guard unavailable reopen; read-only load for relay blob
- final-review findings — relay v2 blob, read-only probe, conflict-bar race, same-cwd clobber, unavailable switch guard
- backpressure re-asserts pause so renderer resume can't latch it off
- never persist unavailable placeholders; atomic .bak; sideline wrong-shape files
- pin the device on approval even after its browse socket closed
- let the caller own reconnect (fresh token), not the socket
- standing phone host survives the boot license race
- add setPhoneAccess to remoteHost stub (post-merge type reconcile)
- attach ws error listeners + process crash guards
- update Pro price in upgrade CTAs
- standing-host imports point at core/ after server-edition refactor
- warn when index.html CSP rewrite marker is absent
- keep the submenu label and default ✓ on one line
- destroy the login node with its removed account
- size by clientWidth, not getBoundingClientRect (zoom-scaled)
- agent-opened nodes inherit the source node's account
- install skill into each managed account's config dir
- actually install on "Restart to update" (was just hiding the window)
- close the Settings overlay when the login node spawns
- more top spacing above the Back-to-app button (pt-10 -> pt-14)
- hide closed projects from the sidebar
- place control-spawned nodes correctly for grouped agents
- clicking a group header shows the group on the canvas
- detect cross-arch spawn-helper clobber + always rebuild after release
- force UTF-8 LANG for spawned terminals (Finder-launched app)
- whole-branch review fixes (jail, retry-by-host, search, index, badge)
- close the master fd on detach + raise the fd soft limit
- persist account-removal cleanup (markDirty) + cancel pending login wait
- scroll the typing indicator into view
- hide the cost chip — misleading on subscription auth
- persist tool cards past turn-done, true Stop semantics, clean fatal teardown
- dispose chat drivers on permanent project delete
- zoom-to-node fits the node instead of forcing >=100% zoom
- zoom-to-node fits the node instead of forcing >=100% zoom
- switching projects re-focuses the list — active expands, others collapse
- raise the open usage popover above the sessions sidebar
- idle_prompt notification resurrected NEEDS YOU on finished nodes
- header badge colors — RUNNING amber (matches spinner/glow), NEEDS YOU red
- retain Notification objects so click handlers survive GC
- post-review hardening — sync single-flight, IPC reject guard, cleanups
- show link handles on all terminal nodes so note links reach any terminal
- async subagent cards flipped to done instantly with no output
- don't lose subagent transcript lines torn mid-write
- don't let the status badge stick on RUNNING after the turn ended
- status badges died after macOS close→dock-reopen (stale window ref)
- drop autoFocus on start-page search to avoid focus-steal on restore
- navigate via the src attribute, not webview.loadURL()
- don't lose Pro to the launch broadcast race or mid-session token expiry
- replace unsupported window.prompt with an in-app InputDialog
- open a blank browser node instead of window.prompt
- throttle+dedup popup spawns and normalize creation URLs
- seed initial webview src once to avoid reload feedback loop
- clicking an unread session in the sidebar keeps it read
- resolve session title strictly by sessionId
- constrain <webview> guest navigation to http(s)/nt-media + deny popups
- close via canonical deleteNodes + guard overlapping confirms
- restrict webview src + openExternal to http(s) schemes
- symlink jail + agent-web CSP + range clamp/416 + stream error guard
- use Claude agent icon for Conversations results
- pass raw (unquoted) remote path to scp so SFTP-mode upload works
- debounce palette search, async/conditional index persist, memoize now
- advertise OSC 52 clipboard cap on the remote tmux (terminal-overrides Ms) + comment fix (final-review)
- only set tmuxConfPath when the remote conf write succeeds (no -f to a missing conf)
- focus a grouped session at its absolute canvas position
- reject non-absolute upload localPath (argv flag-smuggling guard)
- basename upload fileName (no remote path traversal) + scp BatchMode=yes (final-review)
- scope git routing to the active project + panel re-fetch on connect + findSsh login-shell probe (final-review)
- short, space-free ControlMaster socket path (macOS userData too long/spaced)
- quoteRemotePath for remote fs paths (tilde) + explicit sshFs flag (no dialog wrong-write) (final-review)
- raise ssh runner maxBuffer for remote transcript reads + bound subagent cancel set (final-review)
- raw node id in remote hook env + sync master kill on quit + transcript_path jail (final-review)
- resolve remote $HOME so remote hook paths are absolute (no unexpanded ~)
- render Source Control overflow/branch menus above the drawer
- authoritative remote teardown + async create + lifecycle (final-review)
- tilde-expand ~ in remote cwd/listDir paths
- make captureSession remote-aware (mirror snapshotScrollback)
- default bind path to userData base, not filesystem root
- Copy code button — primary variant (clear hover) + 'Copied!' feedback
- clear resize debounce timer before detached-node guard
- add icon scaffold, guard detached-node listeners, fix key isolation
- host co-attaches tmux (no -D) so connecting a client doesn't detach the host
- mirror zooms like the local canvas (Cmd+wheel/pinch zoom-to-cursor)
- untrack accidental node_modules symlink, ignore bare node_modules
- render drop-target ring on the project header too
- use relative import for worktree-ops in main process
- pinned sidebar stays open; AI naming survives close
- surface import result/errors instead of failing silently
- deep-link New remote → SSH settings section + nav count
- keep unpinned sidebar open while hovering it
- re-trigger reveal via nonce; keep revealed dirs collapsible
- guard wtPath against argv flag injection (-- separator + leading-dash reject)
- keep node's persisted sessionId across project switch (meter no longer vanishes)
- keep node's persisted sessionId across project switch (meter no longer vanishes)
- mirror overlay covers canvas chrome + has its own zoom controls
- mirror shows host nodes — fitView on first snapshot + client requests canvas on connect
- card padding, toggle geometry, focus chrome, title-bar inset
- give sidebar buttons explicit backgrounds
- allow native text selection + Cmd+C in chat panel
- move appearance reset to styles.css so it works in dev
- match REF visual language
- map opus/sonnet/fable to 1M window (bare model id can't reveal active 1M)
- kill leaked native button chrome + dark visual polish
- match original overlay z-index and label the search input
- single-line input + skip empty tool-result summaries
- ensure-track the session on node mount so the meter survives restart
- report effective window (200k default, 1M only for [1m]) instead of Models-API capability
- persist client canvas edits + re-broadcast on host project switch
- codex reasoning falls back to content when summary is empty
- tear down remote relay connection on node close + cleanups
- write host NaCl key file with mode 0o600 (security review)
- stop proactive GitHub sign-in nag on a fresh repo
- drop Pro on a definitive server 'inactive' (not just on expiry)
- re-check device-bound status on launch (no key)
- resolve transcript by cwd and fix zoom/listener glitches
- persist context-window store so the meter survives app restart
- gate network calls on packaged build + DO_NOT_TRACK (match telemetry/check)
- advance on-screen highlight on prev/next; a11y + clarity polish
- validate sessionId before filesystem path use (prevent traversal)
- drop dead addClaude/IconClaude; restrict Default pill to builtins
- agent-label notification body text (not just title)
- drop dead ClaudeStatusEvent; agent-label notifications/tooltips; minor cleanups
- clear subagent fan-out only on new turn; restore /loop prompt-prefix fallback
- restore SessionStart/SessionEnd reset (loop + fan-out clear)
- resolve real model window (1M for opus/sonnet) instead of hardcoded 200k
- wire checking state to manual check; drop orphaned banner CSS
- render the full terminal scrollback, not just the viewport
- make subagent/loop nodes selectable
- detect loop/schedule/cron from tools, not just the /prompt prefix
- render the parent->subagent edges (add source handle)
- flag unread unless actively viewing that node
- consent prompt re-asked every launch (hydration race)
- Cmd+C copies the xterm selection to the clipboard
- poll the signal dir so in-file hook appends aren't missed
- proper labels on the notification-consent dialog
- detect state via Claude hooks instead of output parsing
- remove React Flow's default white overlay on group nodes
- show a clear message instead of infinite Loading for images
- isolate node crashes + explorer click-to-select
- harden git/gh args against argv flag smuggling

### Performance

- open the panel fast and keep it warm across close/reopen
- gate the snapshot cast on hasPeers — presence is free when solo (dino Task 4 review)
- drop per-cast canvasSyncTarget allocation on the publish path (collab Task 4 review)
- scope WebGL contexts to viewport-visible nodes
- publish focus only when someone can see it + fix stale docs
- park xterm in renderer instead of tmux client in main
- park detached tmux clients for instant project-switch reattach
- fix scan regressions + land second-sweep findings
- coalesce hot-path work and cap oversized file reads
- unblock main-process I/O and cut renderer churn
- drop the signal-dir polling, rely on event-driven fs.watch

### Security

- surface revoke persistence + teardown failures (no silent success)
- bind peer key + session into MutualApproval, brand the type
- fix 4 relay/server vulns from the audit (Vuln 1-4)
- R4 — encrypt the host E2EE key at rest via safeStorage
- R7 client-mutation allowlist + R5 wss-only pairing offers
- harden pairing trust model (R1–R3)

### Documentation

- record the working watchdog + interrupted rule
- codex agent status fails under snap confinement (root cause + fix)
- the sh shim is the only /control/ client now
- Linux desktop, opencode, docs links; fix dead CLAUDE.md link
- server-edition dictation notes (desktop-dictation Task 12)
- opencode builtin agent implementation plan (7 tasks)
- opencode builtin agent design (codex/gemini parity)
- relay quota behavior + backend contract
- tester-feedback improvements implementation plan (8 tasks, P1-P4)
- tester-feedback improvements design (delivery bug, tmux banner, discovery, onboarding)
- document Team Access + flip spec to landed (team-access Task 5)
- Team Access — 5 tasks (seats, multi-peer pool, store, settings, gate)
- Team Access — multi-seat relay (device-seat + email invite)
- document live spectator mode + flip spec to landed (dino Task 5)
- live dino spectator mode — 5 tasks
- live (shared) dino game — spectator mode via presence
- document live collaboration follows the active session (collab Task 5)
- session-aware live collaboration (presence + canvas-sync over relay)
- document project-scoped sharing (project-scope Task 6)
- project-scoped relay sharing (host picks one project)
- record the per-peer revoke-UI follow-up from the security review
- mark 4c landed — shipped surface, deletions, deferred follow-ups (Stage 4 Task 11)
- protocol migration spec for the relay rpc.ts tunnel
- 4b hand-off — the peer-sink interface 4c plugs into
- note 4b landed + the 4c peer-sink hand-off
- stage 4d trust library delivered (keys, mutual pin+SAS, revoke, consent)
- remote workspace sessions design (team stage 4 — equal peers over relay)
- record Stage 3 (canvas sync) as landed
- stage 2 (terminal co-attach) landed
- permission mode covers terminal nodes, not chat
- mark stage 1 landed, record deltas + two-client smoke test
- scope presence to a project; cap slow-client output with drop-and-redraw
- team presence design (live cursors, cursor chat, terminal co-attach)
- Phase 3c — ptyDestroy tail-teardown + clean-boot follow-ups resolved
- refresh for Server Edition, multi-agent, agent status & three surfaces
- clarify ptyDestroy tail-teardown limitation (accumulates per closed-without-SessionEnd node)
- Phase 2 quickstart, security model, smoke checklist
- server edition phase 1 — core extraction implementation plan
- update project docs / RELEASING + telemetry comment
- correct unmerged-branch comment in remove flow
- rewrite README as a proper project landing page

### Tests

- cover ackDone's fire-and-forget request wiring
- drop the chat-node fixture — the chat kind was removed
- model execFile's exit code on the has-session fake — probeSaysAbsent reads err.code
- delete old-dialect e2e/handler tests (Stage 4 Task 10)
- grep gate — core-bound namespaces come from the session
- pty output fans out to a peer sink via sendBinary with backpressure
- peer sink receives presence + canvas mutations end-to-end
- lock peer-registry boot wiring against regression (4b Task 5)
- two-client convergence, last-write-wins, no echo loop
- pin the single-user path against the co-attach fan-out
- ws.test.ts tears down its sockets and resets the platform
- pin the auto permission-mode default
- agent-status e2e (hook POST → ws); docs(server): Phase 3b scope
- files/scm e2e over ws; docs(server): Phase 3a scope
- e2e — login, ws, real tmux pty echo round-trip
- nav section count 15→16 (stale since Pair phone, f0836bd)
- exercise push-iterable park/wakeup + push-after-end guard
- edge-case regression tests + sanitize node id in filename
- include src/main test files in vitest discovery
- end-to-end relay PTY over E2EE

### Chores

- v0.2.29
- v0.2.28
- v0.2.27
- v0.2.26
- v0.2.25
- v0.2.24
- v0.2.23
- v0.2.22
- v0.2.21
- bump actions/dependency-review-action from 4 to 5
- bump the dev-dependencies group across 1 directory with 10 updates
- bump softprops/action-gh-release from 2 to 3
- bump actions/checkout from 4 to 7
- bump actions/setup-node from 4 to 7
- bump github/codeql-action from 3 to 4
- v0.2.20
- v0.2.19
- sweep the last dead chat references (worktree displacement branch, test comment)
- v0.2.18
- v0.2.17
- v0.2.16
- v0.2.15
- vite 7 / vitest 4 / electron-vite 5 — fix 6 npm-audit vulnerabilities
- v0.2.14
- v0.2.13
- v0.2.12
- v0.2.11
- sync package-lock.json version to 0.2.10
- v0.2.10
- v0.2.9
- v0.2.8
- v0.2.7
- v0.2.6
- untrack the scratch report
- v0.2.5
- untrack internal SDD docs for the public repo; drop dangling spec pointer
- v0.2.4
- v0.2.3
- v0.2.2
- sync package-lock.json (qrcode/@types/qrcode were missing → npm ci failed)
- v0.2.1
- rebuild node-pty after the x64 release build
- pre-publish cleanup pass
- switch to Business Source License 1.1
- relicense from proprietary source-available to FSL-1.1-MIT
- upgrade Electron 31 → 42 (EOL Chromium was a release blocker)
- drop concurrent-session disabledAgents change swept into 2d43854
- track internal SDD docs in the private repo (stripped from public)
- scrub 'REF' reference from cold-restore docs/comments
- drop local-home path from remote e2e tests; ignore publish.sh
- scrub internal/proprietary references for public release
- embed live Stripe Payment Link as CHECKOUT_URL default
- decouple backend into private repo; embed entitlement public key
- move @xterm/addon-search to devDependencies (match xterm siblings)
- remove dead claude-hooks; rename store types; update project docs
- gitignore .claude/ (local agent state + sibling worktrees)
- license as source-available and prepare for public release

## Earlier releases

29 earlier tagged releases (`v0.2.0` … `v0.2.28`,
2026-07-07 – 2026-07-27) predate this generated changelog's detailed window. Browse
them with:

```bash
git log --oneline v0.2.0..v0.2.28
git tag --sort=-creatordate
```

or on GitHub's [tags](https://github.com/eneskirca/nodeterm/tags) and
[releases](https://github.com/eneskirca/nodeterm/releases) pages.

# Unreleased

- Add a guided Open WebUI hosting node with persistent data, local Ollama reuse, an
  OpenAI-compatible provider option, honest first-user setup and health states, backup and restore,
  pinned-image update and rollback, local-only bindings, and anchored regex search for its pickers.
- Add issue #103's local Easter egg cabinet with 60 stable, non-blocking surprises across the
  desktop surfaces. Each entry has English and Cantonese copy, ten funny levels, keyboard and
  touch discovery, reduced-motion behavior, local discovery-only persistence, reset support, and
  complete School-mode suppression. No tests, builds, runtime interaction, or captures were run in
  this lane by explicit scope.
# Unreleased

## Added

- Add first-class GitHub issue and pull-request canvas work-item nodes with safe persistence and
  shared API/account integration. Source-only implementation for upstream #462 and downstream #132;
  verification remains unrun.
