# Integration research — what an adversarial pass actually found

Seven subjects were researched against this codebase, each spec then handed to a completeness
critic that read the repo itself. **All seven specs came back `needs-work`**, and the corrections
below are file-verified rather than stylistic. Each one changes a design decision, and several are
much cheaper to read here than to rediscover.

Licensing first, since it is the hard rule: **every stack here is genuinely free** for what would
actually ship — Home Assistant Apache-2.0, Proxmox VE AGPLv3, GitLab **CE** MIT, FreePBX GPLv3, the
Minecraft stack throughout, Docker with one paid tier that nothing proposed touches. Exceptions are
named per subject rather than waved at.

## Adding a NodeKind: four traps, one of them not compiler-guarded

Every integration here is a canvas node, so this applies to all of them. `NodeKind` is at
`src/shared/types.ts:303`.

1. **`NODE_KIND_TABLE`** (`state/workspace.ts:1266`) is `Record<NodeKind, true>` — a compile-time
   completeness guard. Adding a union member without adding it here is a type error, which is the
   good case: the compiler makes you classify the kind.
2. **`sizeFor(kind)`** in `flowToNodeStates` (`state/workspace.ts:1655`) is a hand-written ternary
   chain ending in `TERMINAL_SIZE`. It is **not** table-driven, so a new kind that skips it
   silently persists at 640x440 with nothing failing. This is the trap the guard does not cover.
3. **Never reuse the `term-` id prefix.** `SAFE_NODE_ID` in `core/project-node-append.ts:28` is
   `/^term-[a-z0-9]+-[a-z0-9]{1,16}$/`, and it is how the mobile-companion append path and the
   relay decide an incoming id may register as a **terminal session**. A new kind borrowing that
   prefix lets a peer be tricked into treating it as a terminal.
4. **`duplicateNode`** (`state/workspace.ts:1322`) strips authority-bearing fields such as
   `initialCommand`, `pendingLaunch`, `respawnNonce` and `worktree`. A kind carrying a live handle
   or a one-shot trigger must be added to that strip list, or duplication clones live state.

Also mandatory: every entry in the `nodeTypes` map (`Canvas.tsx:1521`) is wrapped in
`withNodeBoundary`, so one node's render throw cannot take the whole canvas down.

**And the surface count is four, not three.** Beyond Desktop, Server Edition and mobile, a mutually
approved relay peer is its own boundary: `src/main/relay-rpc-policy.ts` is an exact default-deny
allowlist, so a new machine-global panel is unreachable over relay until somebody deliberately
decides it should be.

## Corrections worth reading before building

**Minecraft — the slice was not shippable, and this corrects our own notes.**
`version_manifest_v2.json` lists only version **ids**. The download URL and its **sha1** live in a
second per-version JSON that no plan fetched or verified. That same per-version JSON also **pins a
required Java major version**, which nothing checked — so a bare-process design silently runs a
Minecraft version against a Java it does not support, and fails looking like a corrupt download.
Both facts are now referenced from the Minecraft page.

The claim that a text console "reuses the entire existing terminal stack for free" was also
refuted: every terminal in this app is a real persistent session with a lifecycle, not a free pipe.

**Home Assistant — the strongest finding was "mostly already possible".** Three existing
capabilities overlap a bespoke node. Home Assistant ships its own **MCP Server** integration. This
repo already has a `browser` NodeKind rendering a real webview (`state/workspace.ts:809`,
`nodes/BrowserNode.tsx`), so an HA dashboard is already reachable on the canvas. And every terminal
node is an unrestricted shell, so `curl` against `/api/states/...` already works today. A dedicated
node has to earn its place against that, and the spec never tried.

**Proxmox — a licensing error.** noVNC is **MPL-2.0, not MIT**, and the spec asserted MIT twice.
Usable as an unmodified dependency, but not on the terms claimed — exactly the detail that must be
right in a project whose own licence converts later.

**GitLab — two problems.** The seam proposed near-verbatim duplication of about ten files from the
existing GitHub integration, which is the copy-and-diverge failure this codebase warns about most.
And `GITLAB_ROOT_PASSWORD` was overstated: checked against GitLab's own install docs, there is no
such recognised variable. A "merge" capability was also listed as ordinary support with no
confirmation step, where an irreversible action owes the two-key gate.

**FreePBX — the slice probably cannot run as the SSH user.** It rests on `asterisk -rx ...`, and the
Asterisk CLI socket is normally restricted to root or the `asterisk` group, so an ordinary project
SSH login will likely be refused. Separately, the spec called SSH port-forwarding future work when
`core/remote-ssh/control-master.ts:486` already ships `hookForwardArgs`.

**Docker — already solved here, plus one injection risk.** `scripts/test-docker-host.mjs` (1030
lines) and the container section of CLAUDE.md already solve SSH-reachable Docker transport and trust
with hard safety rules; the spec designed it from scratch. Its slice also builds
`docker exec -it <container> sh -c '...'` by string interpolation, contradicting this repo's own
named rule about re-validating at the interpolation site.

**A finding about existing code, not a spec.** `OllamaManagerPanel.tsx` was cited as the structural
precedent for universal-feature-contract parity, and the critic found **that panel is itself
non-compliant with two of the mandates** being claimed from it. Worth its own issue: a precedent
nobody has checked propagates its gaps into everything that copies it.

**One spec never mentioned the universal contracts at all** — no language modes, no funny levels, no
regex builder — which is the single most repeated requirement in this project.

## Honest scope

The Minecraft lane's own estimate is **large, multi-week even for its smallest shippable slice**.
The others are smaller but none is a single sitting. Cheapest genuinely useful starting points, in
order: Docker exec-as-terminal-node (least new architecture, leans hardest on what already exists),
then a read-only Proxmox panel, then a read-only GitLab section mirroring the shipped GitHub one.
