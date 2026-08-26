# This fork compared to upstream `eneskirca/nodeterm`

**Measured, not remembered.** Every number here comes from `git` against
`upstream/main` and `main`, and the commands are given so the figures can be
re-derived rather than believed.

```
git merge-base main upstream/main      -> 8c5d4ff5   (15 Aug 2026)
git rev-list --count main..upstream/main   -> 688
git rev-list --count upstream/main..main   -> 948
```

| | upstream ahead of us | us ahead of upstream |
| --- | --- | --- |
| commits | **688** | **948** |
| `feat` | 201 | 163 |
| `fix` | 150 | 313 |
| `docs` | 28 | 87 |
| `test` | 27 | 76 |

Two histories that diverged on 15 August and have not been reconciled since. Nothing
here can be cherry-picked: a port has to be read and re-implemented, because the file
it would land in has usually moved.

---

## What this fork is

**A Material Design 3 application.** That is the difference that explains most of the
others. Upstream is the same product wearing its original visual identity; this fork
rebuilt the interface on M3 tokens, shipped a shared primitive set, and then migrated
the app onto it.

It is also where a large body of accessibility, localization, safety and
self-documentation work lives that upstream does not have at all.

---

## Features this fork has and upstream does not

### The design system

- **A full Material Design 3 token foundation** over the app's own palette, then every
  node kind, settings surface, menu, dialog, notification and command-palette row
  restyled onto it.
- **A shared MD3 primitive set** (`src/renderer/ui/md3/`) of 17 components, with the
  app's own `Button`, `Input`, `Select` and `SegmentedPill` delegating to it, so a call
  site gets the design system without importing anything new.
- **Locally vendored fonts and a codepoint-subsetted icon font**, so nothing is fetched
  from a CDN at runtime.

### Language, voice and tone

- **Language modes** (English, Cantonese, bilingual) with a localization core.
- **Two independent funny-level sliders**, one per language.
- **A narrator**: a spoken TTS queue with its own voice engine and settings section,
  wired into agent status and error notifications.
- **A personal-vocabulary boundary**: a local, private JSON term map applied only at the
  user-facing text boundary.

### Safety and modes

- **Kids mode** end to end: a Home screen, a parent gate, a PIN, its own store and lock,
  a permission gate that actually governs a launch, and a canvas that stops rendering
  the moment the mode says so.
- **School mode** with its own record and unlock route.
- **Five ADHD modes**, which the README had been promising and nothing implemented.
- **Toy locks** on rendered elements, **Support Tickets** as the recovery route, and a
  built-in **TOTP authenticator** that is also a canvas node.
- **The unlock ladder**: play out of a lockout through dim sum, then arithmetic, then
  whack-a-mole, budget-capped so it can never become a weaker password.

### Whole subsystems

- **A Windows session host** — a from-scratch tmux equivalent with real PTYs and
  server-side screen reconstruction, so Windows gets the same cross-restart persistence
  tmux gives every other platform.
- **A file converter** and an **Ollama manager**, both with categorized catalogs, queues
  and their own core engines on both shells.
- **A password manager**, and **project files**: a single-file project save that carries
  the repository inside it and can be password-protected.
- **A Minecraft server engine** behind the metadata resolver, plus six manager node kinds.
- **Scheduled settings**: a schedule engine, storage, external sources, and a live editor.
- **An in-app documentation browser**, bundling 101 articles at build time.
- **A changelog viewer** and a History screen.

### Canvas and editing

- **Drawing on the canvas**: areas, lines and arrows.
- **An animated rainbow node colour**, with its speed as a real control.
- **Nested group trees**, sidebar group reordering, and adding a selection to a group.
- **Native Loop scheduler nodes**, which agents can also manage.
- **An infinite colour picker** reachable from every colour surface, with a ten-format
  translator.
- **A per-element appearance editor** with Word-depth typography plus compositing,
  filters and transforms.

### Engineering and evidence

- **A committed capture harness** that photographs the built artifact, refuses a stale
  build, treats an unreachable required surface as a failure rather than a gap, reads
  every capture back for an all-black frame, and records provenance.
- **A hand-written canonical feature inventory with a guard that has teeth.**
- **Release automation**: every push releases, the version resolves itself, and the
  release code name is resolved by tooling rather than from memory.
- **A regex explainer** with token-by-token annotation and a preset library.
- **Server Edition extras**: one-command Docker hosting, passkey sign-in with password
  fallback, and free TOTP device access.
- **Pricing honesty**: nothing is paid, and the app says so plainly.

---

## Features upstream has and this fork does not

Listed so the gap is visible rather than implied. Counts are upstream commits.

| Area | What it is | Commits |
| --- | --- | --- |
| **Keybindings registry** | A namespaced command registry, per-command capture policy, override sanitization, a pure event-to-command resolver, conflict buckets, directional node focus, and a registry-driven shortcuts panel | ~25 |
| **Browser driving** | A CDP allowlist enforced in main, a debugger lease, interaction verbs, per-project session jars, screenshot and cookie access behind a gate, and a driving indicator | ~20 |
| **Codex accounts** | Machine-scoped accounts, device login, a three-phase switch, an identity proxy, per-account usage, SSH remote runtime install | ~22 |
| **Agent messaging** | An app-owned envelope, a bounded deliver-on-idle queue, rate limits and fan-out caps, a 16-outcome typed decider | ~8 |
| **Breadcrumbs** | Back and forward camera navigation, machine-local stop persistence, and a resume-where-you-left-off card | ~5 |
| **Project capabilities** | Per-project capability switches, off by default, with a one-time clone notice | ~4 |
| **Project icons** | An icon model, sanitizer, glyph, and a picker with emoji, icon-set, avatar and upload tabs | ~11 |
| **Layout zones** | Snap nodes into zones, by keyboard and menu | ~2 |
| **Reopen last closed** | A reopen-history stack, node snapshot and recreate, wired to a chord | ~4 |
| **Other** | Copilot CLI support, a model gateway switcher, a session transfer menu, a resizable card modal, per-agent launch command override, terminal word separators | ~10 |

Ports in progress at the time of writing live on `port/*` branches and are not merged.

---

## Independently arrived at on both sides

Worth naming, because it looks like duplication and is not: several features exist in
both histories, implemented separately after the split.

- **Focus mode** — verified byte-identical in patch content, so one side took the other's.
- **Tidy canvas**, **node maximize**, **keep the machine awake while agents work**, the
  **strict identity verb bucket**, and the **managed hook script stamping its own revision**.

Anyone reconciling the two histories should expect conflicts in exactly these places and
should not read them as a regression.

---

## The upstream snapshot

The repository also tracks canonical upstream as a submodule at `upstream/nodeterm`,
pinned to a reviewed commit. At the time of writing that pin is **152 commits behind**
canonical `main`. It is a deliberately reviewed snapshot, not an automatic mirror, so it
moves only when somebody looks at what changed.

---

## Re-deriving any of this

```bash
git fetch upstream
git merge-base main upstream/main
git rev-list --left-right --count main...upstream/main
git log --no-merges --format=%s main..upstream/main | grep '^feat' | sort -u
git log --no-merges --format=%s upstream/main..main | grep '^feat' | sort -u
```

The lists above are those last two commands, grouped by subject and de-duplicated. Where
a claim here says "verified", it means the tree was checked rather than the commit
subject believed, because a subject line describes an intention and the tree describes
what shipped.
